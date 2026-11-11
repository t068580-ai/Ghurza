import 'server-only'
import { db } from './db'
import { cancelPendingForBid } from './payments/checkout'

// BLIND BIDDING lives here. Rules:
//  - Tailor-facing functions (*ForTailor) only ever load the caller's OWN bid
//    (tailorId: me is in the SQL WHERE). Competitors are summarised by a
//    COUNT/MIN aggregate computed in the database, so no other tailor's row,
//    name, note or amount is ever loaded into Node, let alone sent to a browser.
//  - Lowest/fastest are hidden until there are at least 2 competitors, and even
//    then they are shown as RANGES, never exact numbers. Anyone can open a second
//    tailor account and place a deliberately bad bid to reach the threshold; with
//    exact figures that "sock puppet" would reveal the real competitor's precise
//    quote. A range tells you where you stand without giving that away.
//  - Functions return hand-built objects (DTOs), never raw Prisma rows.

const BLIND_MIN_COMPETITORS = 2

export type CompetitionView = {
  competitorCount: number
  lowestTotalRange: { fromFils: number; toFils: number } | null
  fastestTurnaround: string | null
}

// Rounds a total into a band about 10% wide (at least 5 KWD), aligned to the band
// width, e.g. 245.000 KWD -> 240–264 KWD.
export function totalBand(fils: number): { fromFils: number; toFils: number } {
  const width = Math.max(5000, Math.round((fils * 0.1) / 1000) * 1000)
  const from = Math.floor(fils / width) * width
  return { fromFils: from, toFils: from + width - 1000 }
}

export function turnaroundBand(days: number): string {
  if (days <= 7) return 'within a week'
  if (days <= 14) return '1–2 weeks'
  if (days <= 28) return '2–4 weeks'
  return 'over 4 weeks'
}

export async function listOpenRequestsForTailor(me: string) {
  const rows = await db.request.findMany({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      pieceType: true,
      description: true,
      budgetMinFils: true,
      budgetMaxFils: true,
      neededBy: true,
      createdAt: true,
      referencePhotoId: true,
      _count: { select: { bids: true } },
      bids: { where: { tailorId: me }, select: { status: true } },
    },
  })
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    pieceType: r.pieceType,
    description: r.description,
    budgetMinFils: r.budgetMinFils,
    budgetMaxFils: r.budgetMaxFils,
    neededBy: r.neededBy,
    createdAt: r.createdAt,
    photoId: r.referencePhotoId,
    bidCount: r._count.bids,
    myBidStatus: r.bids[0]?.status ?? null,
  }))
}

export async function getRequestForTailor(requestId: string, me: string) {
  // (a) Public request fields only. No customer, no bids, no payments in the select.
  //     Visible while OPEN, or afterwards only to tailors who bid on it.
  const request = await db.request.findFirst({
    where: { id: requestId, OR: [{ status: 'OPEN' }, { bids: { some: { tailorId: me } } }] },
    select: {
      id: true,
      title: true,
      pieceType: true,
      description: true,
      budgetMinFils: true,
      budgetMaxFils: true,
      neededBy: true,
      status: true,
      createdAt: true,
      referencePhotoId: true,
    },
  })
  if (!request) return null

  // (b) The caller's own bid and its history.
  const myBid = await db.bid.findUnique({
    where: { requestId_tailorId: { requestId, tailorId: me } },
    select: {
      id: true,
      upfrontFils: true,
      completionFils: true,
      totalFils: true,
      turnaroundDays: true,
      note: true,
      status: true,
      version: true,
      revisions: {
        orderBy: { revisionNo: 'desc' },
        select: { revisionNo: true, upfrontFils: true, completionFils: true, totalFils: true, turnaroundDays: true, statusBefore: true, createdAt: true },
      },
    },
  })

  // (c) Everyone else, as numbers only: SELECT COUNT(*), MIN(totalFils), MIN(turnaroundDays).
  const agg = await db.bid.aggregate({
    where: { requestId, tailorId: { not: me }, status: { in: ['PENDING', 'DECLINED'] } },
    _count: { _all: true },
    _min: { totalFils: true, turnaroundDays: true },
  })
  const competitorCount = agg._count._all
  const show = request.status === 'OPEN' && competitorCount >= BLIND_MIN_COMPETITORS
  const competition: CompetitionView = {
    competitorCount: request.status === 'OPEN' ? competitorCount : 0,
    lowestTotalRange: show && agg._min.totalFils != null ? totalBand(agg._min.totalFils) : null,
    fastestTurnaround: show && agg._min.turnaroundDays != null ? turnaroundBand(agg._min.turnaroundDays) : null,
  }

  return { request, myBid, competition }
}

// The only query that returns every bid with the tailor's identity and full
// revision history, and it is scoped to the request's own customer.
export async function getRequestForCustomer(requestId: string, me: string) {
  return db.request.findFirst({
    where: { id: requestId, customerId: me },
    select: {
      id: true,
      title: true,
      pieceType: true,
      description: true,
      budgetMinFils: true,
      budgetMaxFils: true,
      neededBy: true,
      status: true,
      createdAt: true,
      referencePhotoId: true,
      order: { select: { id: true } },
      bids: {
        orderBy: [{ status: 'asc' }, { totalFils: 'asc' }],
        select: {
          id: true,
          upfrontFils: true,
          completionFils: true,
          totalFils: true,
          turnaroundDays: true,
          note: true,
          status: true,
          version: true,
          tailor: { select: { id: true, displayName: true } },
          revisions: {
            orderBy: { revisionNo: 'desc' },
            select: { revisionNo: true, upfrontFils: true, completionFils: true, turnaroundDays: true, statusBefore: true, createdAt: true },
          },
        },
      },
    },
  })
}

export async function listBidsForTailor(me: string) {
  const bids = await db.bid.findMany({
    where: { tailorId: me },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      status: true,
      totalFils: true,
      upfrontFils: true,
      completionFils: true,
      turnaroundDays: true,
      version: true,
      request: { select: { id: true, title: true, pieceType: true, status: true } },
      order: { select: { id: true } },
    },
  })
  return bids
}

type BidInput = { upfront: number; completion: number; turnaroundDays: number; note?: string }

export type BidResult = { ok: true; bidId: string } | { ok: false; error: string }

export async function placeBid(me: string, requestId: string, input: BidInput): Promise<BidResult> {
  try {
    const bidId = await db.$transaction(async (tx) => {
      // First write: proves the request is still OPEN and takes the write lock.
      const open = await tx.request.updateMany({ where: { id: requestId, status: 'OPEN' }, data: { updatedAt: new Date() } })
      if (open.count !== 1) return null
      const bid = await tx.bid.create({
        data: {
          requestId,
          tailorId: me,
          upfrontFils: input.upfront,
          completionFils: input.completion,
          totalFils: input.upfront + input.completion,
          turnaroundDays: input.turnaroundDays,
          note: input.note ?? null,
        },
        select: { id: true },
      })
      await tx.bidRevision.create({
        data: {
          bidId: bid.id,
          revisionNo: 1,
          upfrontFils: input.upfront,
          completionFils: input.completion,
          totalFils: input.upfront + input.completion,
          turnaroundDays: input.turnaroundDays,
          note: input.note ?? null,
          statusBefore: 'NEW',
        },
      })
      return bid.id
    })
    return bidId ? { ok: true, bidId } : { ok: false, error: 'This request is no longer open.' }
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') return { ok: false, error: 'You already bid on this request. Revise your bid instead.' }
    throw e
  }
}

// A revision ADDS a row to BidRevision and moves the bid's current values forward.
// Revising a DECLINED bid puts it back to PENDING (declined is a soft state).
export async function reviseBid(me: string, bidId: string, expectedVersion: number, input: BidInput): Promise<BidResult> {
  const current = await db.bid.findFirst({
    where: { id: bidId, tailorId: me },
    select: { id: true, requestId: true, status: true, version: true, upfrontFils: true, completionFils: true, turnaroundDays: true, note: true },
  })
  if (!current) return { ok: false, error: 'Not found.' }
  if (
    current.upfrontFils === input.upfront &&
    current.completionFils === input.completion &&
    current.turnaroundDays === input.turnaroundDays &&
    (current.note ?? '') === (input.note ?? '')
  ) {
    return { ok: false, error: 'Nothing changed. Adjust the price, days or note to revise.' }
  }

  return db.$transaction(async (tx): Promise<BidResult> => {
    const open = await tx.request.updateMany({ where: { id: current.requestId, status: 'OPEN' }, data: { updatedAt: new Date() } })
    if (open.count !== 1) return { ok: false, error: 'This request is no longer open.' }
    // Re-read the status INSIDE the transaction. The write above holds SQLite's write
    // lock, so a decline can't land between this read and the update below, and the
    // permanent history records the status the bid really had (e.g. DECLINED).
    const fresh = await tx.bid.findFirst({ where: { id: bidId, tailorId: me }, select: { status: true } })
    if (!fresh) return { ok: false, error: 'Not found.' }
    // Compare-and-set on the version: if the bid changed since the form was loaded
    // (another tab, a decline), this matches 0 rows and nothing is written.
    const updated = await tx.bid.updateMany({
      where: { id: bidId, tailorId: me, version: expectedVersion, status: { in: ['PENDING', 'DECLINED'] } },
      data: {
        upfrontFils: input.upfront,
        completionFils: input.completion,
        totalFils: input.upfront + input.completion,
        turnaroundDays: input.turnaroundDays,
        note: input.note ?? null,
        status: 'PENDING',
        declinedAt: null,
        version: expectedVersion + 1,
      },
    })
    if (updated.count !== 1) return { ok: false, error: 'This bid changed or can no longer be revised. Reload the page.' }
    await tx.bidRevision.create({
      data: {
        bidId,
        revisionNo: expectedVersion + 1,
        upfrontFils: input.upfront,
        completionFils: input.completion,
        totalFils: input.upfront + input.completion,
        turnaroundDays: input.turnaroundDays,
        note: input.note ?? null,
        statusBefore: fresh.status,
      },
    })
    await cancelPendingForBid(tx, bidId)
    return { ok: true, bidId }
  })
}

export async function declineBid(me: string, bidId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    // Ownership AND state in the same WHERE: only the request's customer, only a
    // PENDING bid, only while the request is OPEN.
    const r = await tx.bid.updateMany({
      where: { id: bidId, status: 'PENDING', request: { customerId: me, status: 'OPEN' } },
      data: { status: 'DECLINED', declinedAt: new Date() },
    })
    if (r.count !== 1) return false
    await cancelPendingForBid(tx, bidId)
    return true
  })
}
