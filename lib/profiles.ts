import 'server-only'
import { db } from './db'

// Ratings, counts and the portfolio are computed from Review / Order / OrderPhoto on
// every read instead of being stored as counters, so they can't drift or be edited.

export async function getTailorProfile(tailorId: string) {
  const user = await db.user.findFirst({
    where: { id: tailorId, role: 'TAILOR' },
    select: { id: true, displayName: true, createdAt: true, tailorProfile: { select: { bio: true, city: true } } },
  })
  if (!user) return null

  const [ratingAgg, completedCount, portfolio, reviews] = await Promise.all([
    db.review.aggregate({ where: { tailorId }, _avg: { rating: true }, _count: { _all: true } }),
    db.order.count({ where: { tailorId, status: 'COMPLETED' } }),
    db.orderPhoto.findMany({
      where: { inPortfolio: true, order: { tailorId, status: 'COMPLETED' } },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: { uploadId: true, order: { select: { request: { select: { title: true, pieceType: true } }, turnaroundDays: true } } },
    }),
    db.review.findMany({
      where: { tailorId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { rating: true, text: true, createdAt: true, customer: { select: { displayName: true } } },
    }),
  ])

  return {
    id: user.id,
    displayName: user.displayName,
    memberSince: user.createdAt,
    bio: user.tailorProfile?.bio ?? '',
    city: user.tailorProfile?.city ?? '',
    rating: ratingAgg._avg.rating,
    reviewCount: ratingAgg._count._all,
    completedCount,
    portfolio: portfolio.map((p) => ({ uploadId: p.uploadId, title: p.order.request.title, pieceType: p.order.request.pieceType, days: p.order.turnaroundDays })),
    reviews: reviews.map((r) => ({ rating: r.rating, text: r.text, createdAt: r.createdAt, by: r.customer.displayName })),
  }
}

export async function getOwnProfile(me: string) {
  return db.user.findFirst({
    where: { id: me, role: 'TAILOR' },
    select: { displayName: true, tailorProfile: { select: { bio: true, city: true } } },
  })
}

export async function updateOwnProfile(me: string, data: { displayName: string; bio: string; city: string }): Promise<boolean> {
  const user = await db.user.updateMany({ where: { id: me, role: 'TAILOR' }, data: { displayName: data.displayName } })
  if (user.count !== 1) return false
  await db.tailorProfile.upsert({
    where: { userId: me },
    create: { userId: me, bio: data.bio, city: data.city },
    update: { bio: data.bio, city: data.city },
  })
  return true
}
