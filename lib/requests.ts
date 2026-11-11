import 'server-only'
import { db } from './db'
import { discardStored, type StoredImage } from './uploads'

type NewRequest = {
  title: string
  pieceType: string
  description: string
  budgetMin?: number
  budgetMax?: number
  neededBy?: Date
}

// customerId and status are never taken from the form; they come from the session
// and from this code.
export async function createRequest(me: string, input: NewRequest, photo: StoredImage | null): Promise<string> {
  try {
    return await db.$transaction(async (tx) => {
      let referencePhotoId: string | null = null
      if (photo) {
        const up = await tx.upload.create({
          data: { ownerId: me, kind: 'REQUEST_REFERENCE', ...photo },
          select: { id: true },
        })
        referencePhotoId = up.id
      }
      const req = await tx.request.create({
        data: {
          customerId: me,
          title: input.title,
          pieceType: input.pieceType,
          description: input.description,
          budgetMinFils: input.budgetMin ?? null,
          budgetMaxFils: input.budgetMax ?? null,
          neededBy: input.neededBy ?? null,
          referencePhotoId,
        },
        select: { id: true },
      })
      return req.id
    })
  } catch (e) {
    if (photo) await discardStored(photo.storedName)
    throw e
  }
}

export async function listRequestsForCustomer(me: string) {
  return db.request.findMany({
    where: { customerId: me },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      pieceType: true,
      description: true,
      budgetMinFils: true,
      budgetMaxFils: true,
      status: true,
      createdAt: true,
      referencePhotoId: true,
      order: { select: { id: true, status: true } },
      bids: { select: { status: true } },
    },
  })
}

export async function cancelRequest(me: string, requestId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const r = await tx.request.updateMany({
      where: { id: requestId, customerId: me, status: 'OPEN' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    })
    if (r.count !== 1) return false
    await tx.bid.updateMany({ where: { requestId, status: { in: ['PENDING', 'DECLINED'] } }, data: { status: 'LOST' } })
    await tx.payment.updateMany({ where: { requestId, status: 'PENDING' }, data: { status: 'CANCELLED' } })
    return true
  })
}
