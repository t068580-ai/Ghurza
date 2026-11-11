'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireActionUser } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { consume } from '@/lib/rate-limit'
import { bidIdSchema, parseForm, requestIdSchema, requestSchema } from '@/lib/validation'
import { fail, NOT_ALLOWED, NOT_FOUND, TOO_MANY, done, type ActionState } from '@/lib/action-result'
import { createRequest, cancelRequest } from '@/lib/requests'
import { declineBid } from '@/lib/bids'
import { createUpfrontPayment } from '@/lib/payments/checkout'
import { pickFile, storeImage, UploadError, type StoredImage } from '@/lib/uploads'

const MIN = 60 * 1000

export async function createRequestAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireActionUser('CUSTOMER')
  if (!me) return NOT_ALLOWED
  if (!(await consume(`request:${me.id}`, 10, 60 * MIN))) return TOO_MANY

  const file = pickFile(fd, 'photo')
  fd.delete('photo')
  const parsed = parseForm(requestSchema, fd)
  if (!parsed.ok) return fail(parsed.error)

  let photo: StoredImage | null = null
  if (file) {
    try {
      photo = await storeImage(file)
    } catch (e) {
      if (e instanceof UploadError) {
        await audit('UPLOAD_REJECTED', { userId: me.id, detail: { reason: e.message } })
        return fail(e.message)
      }
      throw e
    }
  }
  const id = await createRequest(me.id, parsed.data, photo)
  await audit('REQUEST_CREATED', { userId: me.id, entity: 'Request', entityId: id })
  redirect(`/customer/requests/${id}`)
}

export async function cancelRequestAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireActionUser('CUSTOMER')
  if (!me) return NOT_ALLOWED
  const parsed = parseForm(requestIdSchema, fd)
  if (!parsed.ok) return NOT_FOUND
  const ok = await cancelRequest(me.id, parsed.data.requestId)
  if (!ok) return fail('This request can no longer be cancelled.')
  await audit('REQUEST_CANCELLED', { userId: me.id, entity: 'Request', entityId: parsed.data.requestId })
  revalidatePath(`/customer/requests/${parsed.data.requestId}`)
  return done('Request cancelled.')
}

export async function declineBidAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireActionUser('CUSTOMER')
  if (!me) return NOT_ALLOWED
  const parsed = parseForm(bidIdSchema, fd)
  if (!parsed.ok) return NOT_FOUND
  // Ownership is checked inside declineBid's WHERE clause. Someone else's bid id
  // simply matches nothing and comes back as "not found".
  const ok = await declineBid(me.id, parsed.data.bidId)
  if (!ok) return NOT_FOUND
  await audit('BID_DECLINED', { userId: me.id, entity: 'Bid', entityId: parsed.data.bidId })
  revalidatePath('/customer/requests', 'layout')
  return done('Bid declined. The tailor can still send a revised offer.')
}

// "Accept & pay": the form carries ONLY a bid id. The amount is read from the bid on
// the server. This creates a PENDING payment and sends the customer to the
// provider's checkout page. It creates no order and changes no bid.
export async function startUpfrontPaymentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireActionUser('CUSTOMER')
  if (!me) return NOT_ALLOWED
  if (!(await consume(`pay:init:${me.id}`, 10, 10 * MIN))) return TOO_MANY
  const parsed = parseForm(bidIdSchema, fd)
  if (!parsed.ok) return NOT_FOUND
  const paymentId = await createUpfrontPayment(me.id, parsed.data.bidId)
  if (!paymentId) return fail('This bid can no longer be accepted. Reload the page.')
  await audit('PAYMENT_CREATED', { userId: me.id, entity: 'Payment', entityId: paymentId, detail: { kind: 'UPFRONT' } })
  redirect(`/mock-provider/checkout/${paymentId}`)
}
