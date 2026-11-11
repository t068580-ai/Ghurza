import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from './db'
import { env } from './env'
import { ROLES, type Role } from './enums'
import { isSameOrigin } from './csrf'
import { audit } from './audit'

const IDLE_MS = 24 * 60 * 60 * 1000 // log out after 24 h without activity
const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000 // and after 7 days no matter what
const TOUCH_MS = 5 * 60 * 1000 // refresh lastSeenAt at most every 5 minutes

export type SessionUser = { id: string; role: Role; displayName: string }

function cookieName(): string {
  // __Host- prefix forces Secure, Path=/ and no Domain when served over https.
  return env().APP_ORIGIN.startsWith('https:') ? '__Host-gz_session' : 'gz_session'
}

function tokenId(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function roleHome(role: Role): string {
  return role === 'TAILOR' ? '/tailor/requests' : '/customer/requests'
}

// Cookies can only be written in Server Actions and Route Handlers.
export async function createSession(userId: string): Promise<void> {
  // 256 bits of randomness. Only the SHA-256 is stored, so a leaked copy of the
  // database can't be replayed as session cookies.
  const token = randomBytes(32).toString('base64url')
  await db.session.create({
    data: { id: tokenId(token), userId, expiresAt: new Date(Date.now() + ABSOLUTE_MS) },
  })
  const jar = await cookies()
  jar.set(cookieName(), token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: env().APP_ORIGIN.startsWith('https:') || env().NODE_ENV === 'production',
    maxAge: ABSOLUTE_MS / 1000,
  })
}

// Deletes the session the browser presented (logout, and before login to
// prevent session fixation) and clears the cookie.
export async function destroyPresentedSession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(cookieName())?.value
  if (token) await db.session.deleteMany({ where: { id: tokenId(token) } })
  jar.delete(cookieName())
}

// The single source of truth for "who is this?". The role comes from the database
// on every request, never from the cookie, a hidden field or the URL.
// Any error returns null: fail closed.
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  try {
    const token = (await cookies()).get(cookieName())?.value
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null
    const id = tokenId(token)
    const s = await db.session.findUnique({
      where: { id },
      select: { expiresAt: true, lastSeenAt: true, user: { select: { id: true, role: true, displayName: true } } },
    })
    if (!s) return null
    const now = Date.now()
    if (s.expiresAt.getTime() <= now || s.lastSeenAt.getTime() < now - IDLE_MS) {
      await db.session.deleteMany({ where: { id } })
      return null
    }
    if (s.lastSeenAt.getTime() < now - TOUCH_MS) {
      await db.session.updateMany({ where: { id }, data: { lastSeenAt: new Date(now) } })
    }
    if (!(ROLES as readonly string[]).includes(s.user.role)) return null
    return { id: s.user.id, role: s.user.role as Role, displayName: s.user.displayName }
  } catch {
    return null
  }
})

// ---- Guards for pages ------------------------------------------------------

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

// A page opened by the wrong role sends the user home and renders nothing.
export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireUser()
  if (user.role !== role) redirect(roleHome(user.role))
  return user
}

// ---- Guard for Server Actions ---------------------------------------------
// Every exported Server Action is a public POST endpoint, so each one calls this
// first. Returns null (caller answers with a generic error) when the request is
// cross-site, unauthenticated, or from the wrong role.
export async function requireActionUser(role?: Role): Promise<SessionUser | null> {
  if (!(await isSameOrigin())) {
    await audit('CSRF_REJECTED')
    return null
  }
  const user = await getCurrentUser()
  if (!user) return null
  if (role && user.role !== role) {
    await audit('AUTHZ_DENIED', { userId: user.id, detail: { role: user.role, reason: `needs ${role}` } })
    return null
  }
  return user
}
