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
export async function consume(key: string, limit: number, windowMs: number, blockMs = windowMs, attempt = 0): Promise<boolean> {
  const now = new Date()
  const row = await db.rateLimit.upsert({
    where: { key },
    create: { key, count: 1, windowStart: now },
    update: { count: { increment: 1 } },
  })
  if (row.blockedUntil && row.blockedUntil > now) return false

  if (row.windowStart.getTime() + windowMs <= now.getTime()) {
    // The previous window is over. Exactly ONE request may restart it (compare-and-set
    // on the old windowStart) and count as #1. Every other request in the same burst
    // lost that race and must be counted again in the NEW window. An earlier version
    // returned true for all of them, so a burst at each rollover slipped past the
    // limit (OWASP audit finding).
    const restarted = await db.rateLimit.updateMany({
      where: { key, windowStart: row.windowStart },
      data: { count: 1, windowStart: now, blockedUntil: null },
    })
    if (restarted.count === 1) return true
    if (attempt >= 3) return false // fail closed if it keeps losing the race
    return consume(key, limit, windowMs, blockMs, attempt + 1)
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
