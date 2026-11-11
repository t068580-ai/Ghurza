import 'server-only'
import { db } from './db'
import { orderPartyWhere } from './authz'
import { discardStored, type StoredImage } from './uploads'
import type { Role } from './enums'

// The order state machine. Tailors can move an order forward one step at a time.
// ACCEPTED (creation) and COMPLETED are NOT here: only a verified payment
// (lib/payments/settle.ts) can create or complete an order. There is no generic
// "setStatus", and the target status never comes from the browser.
export const TRANSITIONS = {
  START_WORK: { from: 'ACCEPTED', to: 'IN_PROGRESS' },
  MARK_READY: { from: 'IN_PROGRESS', to: 'READY' },
} as const
export type TransitionEvent = keyof typeof TRANSITIONS

export const MAX_PHOTOS_PER_ORDER = 6

export async function transition(event: TransitionEvent, orderId: string, tailorId: string): Promise<boolean> {
  const t = TRANSITIONS[event]
  const now = new Date()
  const r = await db.order.updateMany({
    where: { id: orderId, tailorId, status: t.from },
    data: event === 'START_WORK' ? { status: t.to, startedAt: now } : { status: t.to, readyAt: now },
  })
  return r.count === 1
}

export async function addFinishedPhoto(tailorId: string, orderId: string, photo: StoredImage, inPortfolio: boolean): Promise<boolean> {
  try {
    return await db.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, tailorId, status: { in: ['IN_PROGRESS', 'READY'] } },
        select: { id: true, _count: { select: { photos: true } } },
      })
      if (!order || order._count.photos >= MAX_PHOTOS_PER_ORDER) {
        await discardStored(photo.storedName)
        return false
      }
      const up = await tx.upload.create({ data: { ownerId: tailorId, kind: 'ORDER_FINISHED', ...photo }, select: { id: true } })
      await tx.orderPhoto.create({ data: { orderId, uploadId: up.id, inPortfolio } })
      return true
    })
  } catch (e) {
    await discardStored(photo.storedName)
    throw e
  }
}

export async function listOrdersFor(userId: string, role: Role) {
  return db.order.findMany({
    where: role === 'TAILOR' ? { tailorId: userId } : { customerId: userId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      status: true,
      totalFils: true,
      createdAt: true,
      request: { select: { title: true, pieceType: true } },
      customer: { select: { displayName: true } },
      tailor: { select: { id: true, displayName: true } },
    },
  })
}

// Everything the order page needs, scoped to the two participants.
export async function getOrderDetail(orderId: string, me: string) {
  return db.order.findFirst({
    where: orderPartyWhere(me, orderId),
    select: {
      id: true,
      status: true,
      customerId: true,
      tailorId: true,
      upfrontFils: true,
      completionFils: true,
      totalFils: true,
      turnaroundDays: true,
      createdAt: true,
      startedAt: true,
      readyAt: true,
      completedAt: true,
      completionPaymentId: true,
      request: { select: { title: true, pieceType: true, description: true, referencePhotoId: true } },
      customer: { select: { displayName: true } },
      tailor: { select: { id: true, displayName: true } },
      photos: { orderBy: { createdAt: 'asc' }, select: { uploadId: true, inPortfolio: true } },
      review: { select: { rating: true, text: true, createdAt: true } },
      payments: {
        where: { status: { in: ['PAID', 'PENDING', 'REFUND_DUE'] } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, kind: true, status: true, amountFils: true, paidAt: true },
      },
    },
  })
}
