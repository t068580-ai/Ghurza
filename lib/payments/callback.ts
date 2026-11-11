import 'server-only'
import { db } from '../db'
import { audit } from '../audit'
import { callbackBodySchema, type CallbackBody } from '../validation'
import { verifyEvent } from './signature'
import { settleVerifiedPayment } from './settle'

// A provider event that has passed signature verification. The brand makes it
// impossible to pass a plain object (for example something built from form data)
// to settleVerifiedPayment(): only this module creates the type.
declare const verifiedBrand: unique symbol
export type VerifiedProviderEvent = CallbackBody & { readonly [verifiedBrand]: true }

export type CallbackResponse = { status: number; body: Record<string, string> }

const MAX_BODY_BYTES = 2048

// Used by the public POST /api/payments/callback route AND by the in-process mock
// provider, so the mock exercises exactly the same verification path.
// Cookies and sessions are deliberately ignored: only the signature counts.
export async function receiveProviderCallback(
  rawBody: string,
  meta: { contentType: string | null; signature: string | null },
): Promise<CallbackResponse> {
  if (!meta.contentType?.toLowerCase().startsWith('application/json')) {
    return { status: 415, body: { error: 'unsupported content type' } }
  }
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return { status: 413, body: { error: 'body too large' } }
  }

  // Verify BEFORE parsing anything.
  const check = verifyEvent(rawBody, meta.signature)
  if (!check.ok) {
    await audit('PAYMENT_BAD_SIGNATURE', { detail: { reason: check.reason } })
    return { status: 401, body: { error: 'invalid signature' } }
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return { status: 400, body: { error: 'invalid json' } }
  }
  const parsed = callbackBodySchema.safeParse(json)
  if (!parsed.success) return { status: 400, body: { error: 'invalid event' } }
  const evt = parsed.data as VerifiedProviderEvent

  const payment = await db.payment.findUnique({
    where: { id: evt.paymentId },
    select: { id: true, amountFils: true, currency: true },
  })
  if (!payment) return { status: 404, body: { error: 'unknown payment' } }

  // The provider must have charged exactly the amount the server asked for.
  if (payment.amountFils !== evt.amountFils || payment.currency !== evt.currency) {
    await audit('PAYMENT_AMOUNT_MISMATCH', { entity: 'Payment', entityId: payment.id, detail: { amountFils: evt.amountFils } })
    return { status: 400, body: { error: 'amount mismatch' } }
  }

  if (evt.status === 'FAILED') {
    const r = await db.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } })
    if (r.count === 1) await audit('PAYMENT_FAILED', { entity: 'Payment', entityId: payment.id })
    return { status: 200, body: { result: r.count === 1 ? 'failed' : 'already_processed' } }
  }

  try {
    const outcome = await settleVerifiedPayment(evt)
    return { status: 200, body: { result: outcome.result } }
  } catch (e) {
    // The transaction rolled back, so the provider can safely retry.
    console.error('settlement failed', e)
    return { status: 500, body: { error: 'settlement failed, retry' } }
  }
}
