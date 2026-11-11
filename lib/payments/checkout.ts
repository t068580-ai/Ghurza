import 'server-only'
import { db, type Tx } from '../db'

// Step 1 of paying: create a PENDING payment. The amount is always read from the
// bid or order row on the server; the form only carries an id. Nothing here creates
// an order or changes a bid. That happens only after a verified provider callback.

const CHECKOUT_TTL_MS = 30 * 60 * 1000

export async function createUpfrontPayment(customerId: string, bidId: string): Promise<string | null> {
  const now = new Date()
  return db.$transaction(async (tx) => {
    const bid = await tx.bid.findFirst({
      where: { id: bidId, status: 'PENDING', request: { customerId, status: 'OPEN' } },
      select: { id: true, requestId: true, upfrontFils: true, version: true },
    })
    if (!bid) return null

    // A double-click reuses the same checkout instead of opening a second one.
    const existing = await tx.payment.findFirst({
      where: { bidId: bid.id, kind: 'UPFRONT', status: 'PENDING', bidVersion: bid.version, customerId, expiresAt: { gt: now } },
      select: { id: true },
    })
    if (existing) return existing.id

    // Only one open checkout per request at a time.
    await tx.payment.updateMany({
      where: { requestId: bid.requestId, kind: 'UPFRONT', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    })
    const payment = await tx.payment.create({
      data: {
        kind: 'UPFRONT',
        amountFils: bid.upfrontFils,
        customerId,
        requestId: bid.requestId,
        bidId: bid.id,
        bidVersion: bid.version,
        expiresAt: new Date(now.getTime() + CHECKOUT_TTL_MS),
      },
      select: { id: true },
    })
    return payment.id
  })
}

export async function createCompletionPayment(customerId: string, orderId: string): Promise<string | null> {
  const now = new Date()
  return db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, customerId, status: 'READY', completionPaymentId: null },
      select: { id: true, requestId: true, bidId: true, completionFils: true, bid: { select: { version: true } } },
    })
    if (!order) return null

    const existing = await tx.payment.findFirst({
      where: { orderId: order.id, kind: 'COMPLETION', status: 'PENDING', customerId, expiresAt: { gt: now } },
      select: { id: true },
    })
    if (existing) return existing.id

    const payment = await tx.payment.create({
      data: {
        kind: 'COMPLETION',
        amountFils: order.completionFils,
        customerId,
        requestId: order.requestId,
        bidId: order.bidId,
        bidVersion: order.bid.version,
        orderId: order.id,
        expiresAt: new Date(now.getTime() + CHECKOUT_TTL_MS),
      },
      select: { id: true },
    })
    return payment.id
  })
}

// When a bid is revised or declined, any checkout opened for the old numbers dies.
export async function cancelPendingForBid(tx: Tx, bidId: string): Promise<void> {
  await tx.payment.updateMany({ where: { bidId, status: 'PENDING' }, data: { status: 'CANCELLED' } })
}
