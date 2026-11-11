import 'server-only'
import { db } from './db'
import type { SessionUser } from './auth'

// Ownership always goes into the WHERE clause of the same query that reads the row.
// There is never a "load by id, then check the owner in an if". A row that belongs
// to someone else is therefore indistinguishable from one that doesn't exist (404),
// which is what defeats IDOR: changing an id in the URL just gives "Not found".

export function orderPartyWhere(userId: string, orderId: string) {
  return { id: orderId, OR: [{ customerId: userId }, { tailorId: userId }] }
}

export async function getOrderForParticipant(orderId: string, userId: string) {
  return db.order.findFirst({
    where: orderPartyWhere(userId, orderId),
    select: { id: true, customerId: true, tailorId: true, status: true },
  })
}

type UploadForCheck = {
  ownerId: string
  kind: string
  request: { customerId: string; status: string; bids: { tailorId: string }[] } | null
  orderPhoto: { inPortfolio: boolean; order: { customerId: string; tailorId: string; status: string } } | null
}

export async function loadUploadForCheck(uploadId: string, viewerId: string | null) {
  return db.upload.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      ownerId: true,
      kind: true,
      storedName: true,
      mimeType: true,
      request: {
        select: {
          customerId: true,
          status: true,
          // Only the viewer's own bid is loaded, never other tailors'.
          bids: { where: { tailorId: viewerId ?? '__nobody__' }, select: { tailorId: true } },
        },
      },
      orderPhoto: { select: { inPortfolio: true, order: { select: { customerId: true, tailorId: true, status: true } } } },
    },
  })
}

// Who may see an uploaded image:
//  - a request's reference photo: its customer; any tailor while the request is OPEN;
//    afterwards only tailors who bid on it
//  - a finished-piece photo: the order's customer and tailor; everyone once the
//    order is COMPLETED and the tailor put it in their portfolio
//  - an upload not attached to anything: its owner only
export function canViewUpload(viewer: SessionUser | null, u: UploadForCheck): { allowed: boolean; isPublic: boolean } {
  if (u.kind === 'REQUEST_REFERENCE' && u.request) {
    if (!viewer) return { allowed: false, isPublic: false }
    if (viewer.id === u.request.customerId) return { allowed: true, isPublic: false }
    if (viewer.role === 'TAILOR' && (u.request.status === 'OPEN' || u.request.bids.length > 0)) {
      return { allowed: true, isPublic: false }
    }
    return { allowed: false, isPublic: false }
  }
  if (u.kind === 'ORDER_FINISHED' && u.orderPhoto) {
    const o = u.orderPhoto.order
    if (o.status === 'COMPLETED' && u.orderPhoto.inPortfolio) return { allowed: true, isPublic: true }
    if (viewer && (viewer.id === o.customerId || viewer.id === o.tailorId)) return { allowed: true, isPublic: false }
    return { allowed: false, isPublic: false }
  }
  return { allowed: !!viewer && viewer.id === u.ownerId, isPublic: false }
}
