import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '../db'
import { env } from '../env'
import { signEvent } from './signature'
import { receiveProviderCallback } from './callback'

// Stands in for a hosted payment page (MyFatoorah, Tap, Stripe...). In real life the
// customer types card details on the PROVIDER's site and the provider calls our
// callback URL. Here the "provider" lives in the same process, so it signs the event
// with the shared secret and hands it to the same receiveProviderCallback() the
// public route uses. No card data is ever collected by this app.

export function mockPaymentsEnabled(): boolean {
  return env().MOCK_PAYMENTS === 'true'
}

export async function getPendingCheckout(paymentId: string, payerId: string) {
  if (!mockPaymentsEnabled()) return null
  return db.payment.findFirst({
    where: { id: paymentId, customerId: payerId, status: 'PENDING', expiresAt: { gt: new Date() } },
    select: {
      id: true,
      kind: true,
      amountFils: true,
      currency: true,
      expiresAt: true,
      request: { select: { title: true } },
    },
  })
}

export async function mockProviderDecide(paymentId: string, payerId: string, outcome: 'PAID' | 'FAILED'): Promise<boolean> {
  const p = await getPendingCheckout(paymentId, payerId)
  if (!p) return false
  const rawBody = JSON.stringify({
    paymentId: p.id,
    amountFils: p.amountFils,
    currency: p.currency,
    status: outcome,
    providerRef: `mock_${randomUUID()}`,
  })
  const res = await receiveProviderCallback(rawBody, { contentType: 'application/json', signature: signEvent(rawBody) })
  return res.status === 200
}
