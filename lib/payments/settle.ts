import 'server-only'
import { db, type Tx } from '../db'
import { audit } from '../audit'
import type { VerifiedProviderEvent } from './callback'

// THE ONLY PLACE AN ORDER IS CREATED OR COMPLETED.
// It accepts only a VerifiedProviderEvent, a type that only receiveProviderCallback()
// can produce after checking the HMAC signature. Clicking "Accept & pay", visiting
// the return URL, or replaying a form can never reach this code.

export type SettleOutcome = {
  result: 'applied' | 'already_processed' | 'refund_due'
  kind?: 'UPFRONT' | 'COMPLETION'
  orderId?: string
  reason?: string
}

async function markRefundDue(tx: Tx, paymentId: string, providerRef: string) {
  await tx.payment.updateMany({
    where: { id: paymentId, status: { in: ['PAID', 'CANCELLED', 'FAILED'] } },
    data: { status: 'REFUND_DUE', providerRef },
  })
}

export async function settleVerifiedPayment(evt: VerifiedProviderEvent): Promise<SettleOutcome> {
  const now = new Date()
  const outcome = await db.$transaction(
    async (tx): Promise<SettleOutcome & { customerId?: string; tailorId?: string }> => {
      // 1. Claim the payment. This compare-and-set is the first write, so it takes
      //    SQLite's write lock: two concurrent callbacks can't both get past it.
      const claim = await tx.payment.updateMany({
        where: { id: evt.paymentId, status: 'PENDING', amountFils: evt.amountFils },
        data: { status: 'PAID', paidAt: now, providerRef: evt.providerRef },
      })
      if (claim.count === 0) {
        const p = await tx.payment.findUnique({ where: { id: evt.paymentId }, select: { status: true } })
        if (!p) throw new Error('payment not found during settlement')
        if (p.status === 'PAID' || p.status === 'REFUND_DUE') return { result: 'already_processed' }
        // Cancelled or failed on our side, but the provider took the money anyway.
        await markRefundDue(tx, evt.paymentId, evt.providerRef)
        return { result: 'refund_due', reason: `payment was ${p.status}` }
      }

      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: evt.paymentId },
        select: { id: true, kind: true, amountFils: true, customerId: true, requestId: true, bidId: true, bidVersion: true, orderId: true },
      })

      if (payment.kind === 'UPFRONT') {
        const bid = await tx.bid.findUnique({
          where: { id: payment.bidId },
          select: { id: true, status: true, version: true, upfrontFils: true, completionFils: true, totalFils: true, turnaroundDays: true, tailorId: true, requestId: true },
        })
        const request = await tx.request.findUnique({
          where: { id: payment.requestId },
          select: { id: true, status: true, customerId: true },
        })
        // The customer paid for one specific version of one bid. If anything moved
        // since the checkout opened, no order is created and the money is flagged.
        const valid =
          bid && request &&
          bid.status === 'PENDING' &&
          bid.version === payment.bidVersion &&
          bid.upfrontFils === payment.amountFils &&
          bid.requestId === request.id &&
          request.status === 'OPEN' &&
          request.customerId === payment.customerId
        if (!valid) {
          await markRefundDue(tx, payment.id, evt.providerRef)
          return { result: 'refund_due', reason: 'bid or request changed after checkout' }
        }

        const awarded = await tx.request.updateMany({
          where: { id: request.id, status: 'OPEN' },
          data: { status: 'AWARDED', awardedAt: now },
        })
        const accepted = await tx.bid.updateMany({
          where: { id: bid.id, status: 'PENDING', version: bid.version },
          data: { status: 'ACCEPTED' },
        })
        if (awarded.count !== 1 || accepted.count !== 1) throw new Error('state changed during settlement')

        await tx.bid.updateMany({
          where: { requestId: request.id, id: { not: bid.id }, status: { in: ['PENDING', 'DECLINED'] } },
          data: { status: 'LOST' },
        })
        const order = await tx.order.create({
          data: {
            requestId: request.id,
            bidId: bid.id,
            customerId: request.customerId,
            tailorId: bid.tailorId,
            upfrontPaymentId: payment.id,
            upfrontFils: bid.upfrontFils,
            completionFils: bid.completionFils,
            totalFils: bid.totalFils,
            turnaroundDays: bid.turnaroundDays,
          },
          select: { id: true },
        })
        await tx.payment.update({ where: { id: payment.id }, data: { orderId: order.id } })
        await tx.payment.updateMany({ where: { requestId: request.id, status: 'PENDING' }, data: { status: 'CANCELLED' } })
        return { result: 'applied', kind: 'UPFRONT', orderId: order.id, customerId: request.customerId, tailorId: bid.tailorId }
      }

      // COMPLETION: the final payment moves READY -> COMPLETED, nothing else does.
      if (!payment.orderId) {
        await markRefundDue(tx, payment.id, evt.providerRef)
        return { result: 'refund_due', reason: 'completion payment without an order' }
      }
      const completed = await tx.order.updateMany({
        where: {
          id: payment.orderId,
          customerId: payment.customerId,
          status: 'READY',
          completionPaymentId: null,
          completionFils: payment.amountFils,
        },
        data: { status: 'COMPLETED', completedAt: now, completionPaymentId: payment.id },
      })
      if (completed.count !== 1) {
        await markRefundDue(tx, payment.id, evt.providerRef)
        return { result: 'refund_due', reason: 'order was not READY' }
      }
      await tx.payment.updateMany({
        where: { orderId: payment.orderId, kind: 'COMPLETION', status: 'PENDING' },
        data: { status: 'CANCELLED' },
      })
      return { result: 'applied', kind: 'COMPLETION', orderId: payment.orderId, customerId: payment.customerId }
    },
    { timeout: 10_000 },
  )

  // Audit only after the transaction committed.
  if (outcome.result === 'applied') {
    await audit('PAYMENT_PAID', { userId: outcome.customerId, entity: 'Payment', entityId: evt.paymentId, detail: { kind: outcome.kind ?? null, amountFils: evt.amountFils } })
    if (outcome.kind === 'UPFRONT') {
      await audit('ORDER_CREATED', { userId: outcome.customerId, entity: 'Order', entityId: outcome.orderId })
    } else {
      await audit('ORDER_TRANSITION', { userId: outcome.customerId, entity: 'Order', entityId: outcome.orderId, detail: { from: 'READY', to: 'COMPLETED' } })
    }
  } else if (outcome.result === 'refund_due') {
    await audit('PAYMENT_REFUND_DUE', { entity: 'Payment', entityId: evt.paymentId, detail: { reason: outcome.reason ?? null } })
  }
  return { result: outcome.result, kind: outcome.kind, orderId: outcome.orderId, reason: outcome.reason }
}
