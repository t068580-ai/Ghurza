'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireActionUser } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { consume } from '@/lib/rate-limit'
import { db } from '@/lib/db'
import { messageSchema, orderIdSchema, parseForm, photoSchema, reviewSchema } from '@/lib/validation'
import { fail, isUniqueViolation, NOT_ALLOWED, NOT_FOUND, TOO_MANY, done, type ActionState } from '@/lib/action-result'
import { addFinishedPhoto, transition, type TransitionEvent } from '@/lib/orders'
import { sendMessage } from '@/lib/messages'
import { createCompletionPayment } from '@/lib/payments/checkout'
import { pickFile, storeImage, UploadError } from '@/lib/uploads'

const MIN = 60 * 1000

async function tailorTransition(event: TransitionEvent, fd: FormData): Promise<ActionState> {
  const me = await requireActionUser('TAILOR')
  if (!me) return NOT_ALLOWED
  const parsed = parseForm(orderIdSchema, fd)
  if (!parsed.ok) return NOT_FOUND
  // The WHERE clause carries tailorId = me AND the expected from-state.
  const ok = await transition(event, parsed.data.orderId, me.id)
  if (!ok) return fail('Not allowed in the current state.')
  await audit('ORDER_TRANSITION', { userId: me.id, entity: 'Order', entityId: parsed.data.orderId, detail: { event } })
  revalidatePath(`/orders/${parsed.data.orderId}`)
  return done(event === 'START_WORK' ? 'Marked as in progress.' : 'Marked as ready. The customer can now pay the balance.')
}

export async function startWorkAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return tailorTransition('START_WORK', fd)
}

export async function markReadyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return tailorTransition('MARK_READY', fd)
}

export async function addPhotoAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireActionUser('TAILOR')
  if (!me) return NOT_ALLOWED
  if (!(await consume(`photo:${me.id}`, 20, 60 * MIN))) return TOO_MANY
  const file = pickFile(fd, 'photo')
  fd.delete('photo')
  const parsed = parseForm(photoSchema, fd)
  if (!parsed.ok) return NOT_FOUND
  if (!file) return fail('Choose a photo first.')
  let stored
  try {
    stored = await storeImage(file)
  } catch (e) {
    if (e instanceof UploadError) {
      await audit('UPLOAD_REJECTED', { userId: me.id, detail: { reason: e.message } })
      return fail(e.message)
    }
    throw e
  }
  const ok = await addFinishedPhoto(me.id, parsed.data.orderId, stored, parsed.data.inPortfolio === 'on')
  if (!ok) return fail('Photos can be added while the order is in progress or ready, up to 6.')
  revalidatePath(`/orders/${parsed.data.orderId}`)
  return done('Photo added.')
}

// The balance: same flow as the deposit. Amount from the order row; a verified
// provider callback is the only thing that can mark the order COMPLETED.
export async function startCompletionPaymentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireActionUser('CUSTOMER')
  if (!me) return NOT_ALLOWED
  if (!(await consume(`pay:init:${me.id}`, 10, 10 * MIN))) return TOO_MANY
  const parsed = parseForm(orderIdSchema, fd)
  if (!parsed.ok) return NOT_FOUND
  const paymentId = await createCompletionPayment(me.id, parsed.data.orderId)
  if (!paymentId) return fail('The balance can be paid once the tailor marks the piece ready.')
  await audit('PAYMENT_CREATED', { userId: me.id, entity: 'Payment', entityId: paymentId, detail: { kind: 'COMPLETION' } })
  redirect(`/mock-provider/checkout/${paymentId}`)
}

export async function sendMessageAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireActionUser()
  if (!me) return NOT_ALLOWED
  const parsed = parseForm(messageSchema, fd)
  if (!parsed.ok) return fail(parsed.error)
  // Keyed per user only: an id from the form isn't trusted to create new rows in the
  // rate-limit table (made-up order ids would otherwise grow it without bound).
  if (!(await consume(`msg:${me.id}`, 30, MIN))) return TOO_MANY
  // senderId is the session user; the participant check runs inside sendMessage.
  const ok = await sendMessage(parsed.data.orderId, me.id, parsed.data.body)
  if (!ok) return NOT_FOUND
  return { ok: true }
}

export async function submitReviewAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireActionUser('CUSTOMER')
  if (!me) return NOT_ALLOWED
  const parsed = parseForm(reviewSchema, fd)
  if (!parsed.ok) return fail(parsed.error)
  const { orderId, rating, text } = parsed.data
  const order = await db.order.findFirst({
    where: { id: orderId, customerId: me.id, status: 'COMPLETED' },
    select: { id: true, tailorId: true },
  })
  if (!order) return fail('You can review an order once it is completed.')
  try {
    // tailorId is copied from the order row, never from the form.
    await db.review.create({ data: { orderId: order.id, customerId: me.id, tailorId: order.tailorId, rating, text } })
  } catch (e) {
    if (isUniqueViolation(e)) return fail('You already reviewed this order.')
    throw e
  }
  await audit('REVIEW_CREATED', { userId: me.id, entity: 'Order', entityId: order.id })
  revalidatePath(`/orders/${order.id}`)
  return done('Thank you. Your review is now on the tailor’s profile.')
}
