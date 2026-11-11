'use server'

// Every export of a 'use server' file is a public POST endpoint, so this file
// exports only guarded actions. Helpers live in lib/.

import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { createSession, destroyPresentedSession, getCurrentUser, roleHome } from '@/lib/auth'
import { burnPasswordCheck, hashPassword, needsRehash, passwordProblem, PasswordCheckBusyError, verifyPassword } from '@/lib/password'
import { consume, hashKey, reset } from '@/lib/rate-limit'
import { audit, clientIp } from '@/lib/audit'
import { isSameOrigin } from '@/lib/csrf'
import { loginSchema, parseForm, signupSchema } from '@/lib/validation'
import { fail, isUniqueViolation, NOT_ALLOWED, TOO_MANY, type ActionState } from '@/lib/action-result'
import type { Role } from '@/lib/enums'

const MIN = 60 * 1000

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await isSameOrigin())) return NOT_ALLOWED
  const parsed = parseForm(loginSchema, fd)
  if (!parsed.ok) return fail(parsed.error)
  const { email, password } = parsed.data

  // Every attempt is COUNTED before the password is checked (atomic increment), so a
  // burst of parallel guesses can't all slip through before the first failure is
  // recorded. The account key is the hashed email, so unknown emails are throttled
  // the same way. A successful login clears the counter.
  const acctKey = `login:acct:${hashKey(email)}`
  if (!(await consume(acctKey, 5, 15 * MIN, 15 * MIN))) {
    await audit('RATE_LIMITED', { detail: { reason: 'login account' } })
    return TOO_MANY
  }
  const ip = await clientIp()
  if (ip && !(await consume(`login:ip:${hashKey(ip)}`, 50, 15 * MIN))) {
    await audit('RATE_LIMITED', { detail: { reason: 'login ip' } })
    return TOO_MANY
  }

  const user = await db.user.findUnique({ where: { email }, omit: { passwordHash: false } })
  let ok = false
  try {
    if (user) ok = await verifyPassword(password, user.passwordHash)
    else await burnPasswordCheck(password) // same timing whether or not the email exists
  } catch (e) {
    if (e instanceof PasswordCheckBusyError) return TOO_MANY
    throw e
  }

  if (!user || !ok) {
    await audit('LOGIN_FAILED', { userId: user?.id ?? null })
    // One message for both cases: never reveal whether the email has an account.
    return fail('Invalid email or password.')
  }

  await reset(acctKey)
  await destroyPresentedSession() // never keep a session id chosen before login (fixation)
  await db.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } })
  if (needsRehash(user.passwordHash)) {
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } })
  }
  await createSession(user.id)
  await audit('LOGIN_SUCCESS', { userId: user.id })
  redirect(roleHome(user.role as Role))
}

export async function signupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!(await isSameOrigin())) return NOT_ALLOWED
  // Validate first, so junk submissions don't use up anyone's allowance.
  const parsed = parseForm(signupSchema, fd)
  if (!parsed.ok) return fail(parsed.error)
  const { email, password, displayName, role } = parsed.data
  const problem = passwordProblem(password, email)
  if (problem) return fail(problem)

  // Per email address (not one shared key that a stranger could exhaust for
  // everybody), plus per client IP when a trusted proxy tells us the IP.
  const ip = await clientIp()
  const limited =
    !(await consume(`signup:email:${hashKey(email)}`, 3, 60 * MIN)) ||
    (ip !== null && !(await consume(`signup:ip:${hashKey(ip)}`, 5, 60 * MIN)))
  if (limited) {
    await audit('RATE_LIMITED', { detail: { reason: 'signup' } })
    return TOO_MANY
  }

  // This is the ONLY place a role chosen in the browser is accepted, and only as
  // one of the two enum values. Nothing ever updates it afterwards (trigger-enforced).
  let passwordHash: string
  try {
    passwordHash = await hashPassword(password)
  } catch (e) {
    if (e instanceof PasswordCheckBusyError) return TOO_MANY
    throw e
  }
  let userId: string
  try {
    userId = await db.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email, passwordHash, displayName, role }, select: { id: true } })
      if (role === 'TAILOR') await tx.tailorProfile.create({ data: { userId: u.id } })
      return u.id
    })
  } catch (e) {
    if (isUniqueViolation(e)) return fail('Could not create the account. If you already registered, sign in instead.')
    throw e
  }
  await destroyPresentedSession()
  await createSession(userId)
  await audit('SIGNUP', { userId, detail: { role } })
  redirect(roleHome(role as Role))
}

export async function logoutAction(): Promise<void> {
  if (!(await isSameOrigin())) return
  const user = await getCurrentUser()
  await destroyPresentedSession()
  if (user) await audit('LOGOUT', { userId: user.id })
  redirect('/login')
}
