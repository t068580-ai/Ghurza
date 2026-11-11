import 'server-only'
import { createHash } from 'node:crypto'
import { db } from './db'

// Fixed-window counters stored in the database, so they survive dev-server
// restarts and hot reloads (an in-memory Map would reset on every save).

export function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

export async function isBlocked(key: string): Promise<boolean> {
  const row = await db.rateLimit.findUnique({ where: { key } })
  return !!row?.blockedUntil && row.blockedUntil > new Date()
}

// Counts one attempt and returns false when the caller is over the limit.
//
// The increment is a single atomic statement (Prisma turns this upsert into
// INSERT ... ON CONFLICT DO UPDATE on SQLite). A read-then-write version would let
// 200 parallel requests all read "count = 0" and all pass; this one gives each
// request its own number, so request #6 of 5 is refused even under a burst.
export async function consume(key: string, limit: number, windowMs: number, blockMs = windowMs): Promise<boolean> {
  const now = new Date()
  const row = await db.rateLimit.upsert({
    where: { key },
    create: { key, count: 1, windowStart: now },
    update: { count: { increment: 1 } },
  })
  if (row.blockedUntil && row.blockedUntil > now) return false

  if (row.windowStart.getTime() + windowMs <= now.getTime()) {
    // The previous window is over: start a fresh one with this request as #1.
    await db.rateLimit.updateMany({
      where: { key, windowStart: row.windowStart },
      data: { count: 1, windowStart: now, blockedUntil: null },
    })
    return true
  }

  if (row.count > limit) {
    await db.rateLimit.updateMany({ where: { key }, data: { blockedUntil: new Date(now.getTime() + blockMs) } })
    return false
  }

  // Occasionally clear out stale rows so the table can't grow forever.
  if (Math.random() < 0.01) {
    const dayAgo = new Date(now.getTime() - 86_400_000)
    await db.rateLimit.deleteMany({
      where: { windowStart: { lt: dayAgo }, OR: [{ blockedUntil: null }, { blockedUntil: { lt: now } }] },
    })
  }
  return true
}

export async function reset(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } })
}
