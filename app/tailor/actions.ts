'use server'

import { revalidatePath } from 'next/cache'
import { requireActionUser } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { consume } from '@/lib/rate-limit'
import { parseForm, placeBidSchema, profileSchema, reviseBidSchema } from '@/lib/validation'
import { fail, NOT_ALLOWED, TOO_MANY, done, type ActionState } from '@/lib/action-result'
import { placeBid, reviseBid } from '@/lib/bids'
import { updateOwnProfile } from '@/lib/profiles'

const MIN = 60 * 1000

// tailorId is never read from the form; it is the session user.
export async function placeBidAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireActionUser('TAILOR')
  if (!me) return NOT_ALLOWED
  if (!(await consume(`bid:${me.id}`, 30, 60 * MIN))) return TOO_MANY
  const parsed = parseForm(placeBidSchema, fd)
  if (!parsed.ok) return fail(parsed.error)
  const { requestId, upfront, completion, turnaroundDays, note } = parsed.data
  const r = await placeBid(me.id, requestId, { upfront, completion, turnaroundDays, note })
  if (!r.ok) return fail(r.error)
  await audit('BID_PLACED', { userId: me.id, entity: 'Bid', entityId: r.bidId, detail: { amountFils: upfront + completion } })
  revalidatePath(`/tailor/requests/${requestId}`)
  return done('Bid placed. The customer can see it now.')
}

export async function reviseBidAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireActionUser('TAILOR')
  if (!me) return NOT_ALLOWED
  if (!(await consume(`bid:${me.id}`, 30, 60 * MIN))) return TOO_MANY
  const parsed = parseForm(reviseBidSchema, fd)
  if (!parsed.ok) return fail(parsed.error)
  const { bidId, expectedVersion, upfront, completion, turnaroundDays, note } = parsed.data
  const r = await reviseBid(me.id, bidId, expectedVersion, { upfront, completion, turnaroundDays, note })
  if (!r.ok) return fail(r.error)
  await audit('BID_REVISED', { userId: me.id, entity: 'Bid', entityId: bidId, detail: { to: expectedVersion + 1, amountFils: upfront + completion } })
  revalidatePath('/tailor', 'layout')
  return done('Bid revised. The customer sees this new version and every earlier one.')
}

export async function updateProfileAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireActionUser('TAILOR')
  if (!me) return NOT_ALLOWED
  const parsed = parseForm(profileSchema, fd)
  if (!parsed.ok) return fail(parsed.error)
  if (!(await updateOwnProfile(me.id, parsed.data))) return NOT_ALLOWED
  revalidatePath('/', 'layout')
  return done('Profile saved.')
}
