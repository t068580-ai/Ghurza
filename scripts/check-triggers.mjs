// Security check: tries writes that bypass the app entirely (raw SQL) and confirms the
// database refuses each one. Run against a seeded dev database:
//   node scripts/check-triggers.mjs
// Every line should say "blocked". It never modifies data: each write is rejected.
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient({ log: [] })
let failures = 0

async function expectBlocked(label, sql, ...params) {
  try {
    await db.$executeRawUnsafe(sql, ...params)
    failures++
    console.log(`FAIL  ${label}: the database ALLOWED this write`)
  } catch (e) {
    const reason = /(?:message|Message): [`"]?([^`"\n]+)/.exec(e.message)?.[1] ?? e.message.split('\n').filter(Boolean).at(-1)
    console.log(`ok    ${label.padEnd(48)} -> ${reason.slice(0, 90)}`)
  }
}

const rev = await db.bidRevision.findFirst()
const inProgress = await db.order.findFirst({ where: { status: 'IN_PROGRESS' } })
const completed = await db.order.findFirst({ where: { status: 'COMPLETED' } })
const pendingBid = await db.bid.findFirst({ where: { status: 'PENDING' }, include: { request: true } })
const customer = await db.user.findFirst({ where: { role: 'CUSTOMER' } })
const outsider = await db.user.findFirst({ where: { role: 'CUSTOMER', id: { not: inProgress?.customerId } } })
const review = await db.review.findFirst()
if (!rev || !inProgress || !completed || !pendingBid || !customer || !outsider || !review) {
  console.error('Seed the database first: npm run db:reset')
  process.exit(1)
}
const now = Date.now()

await expectBlocked('edit a bid revision (rewrite history)', 'UPDATE "BidRevision" SET upfrontFils = 1 WHERE id = ?', rev.id)
await expectBlocked('delete a bid revision', 'DELETE FROM "BidRevision" WHERE id = ?', rev.id)
await expectBlocked('edit a posted review', 'UPDATE "Review" SET rating = 1 WHERE id = ?', review.id)
await expectBlocked('order IN_PROGRESS -> COMPLETED, no payment', 'UPDATE orders SET status = ? WHERE id = ?', 'COMPLETED', inProgress.id)
await expectBlocked('order COMPLETED -> READY (backwards)', 'UPDATE orders SET status = ? WHERE id = ?', 'READY', completed.id)
await expectBlocked('change the price of an existing order', 'UPDATE orders SET completionFils = 1 WHERE id = ?', inProgress.id)
await expectBlocked(
  'create an order without a paid deposit',
  'INSERT INTO orders (id, requestId, bidId, customerId, tailorId, upfrontPaymentId, upfrontFils, completionFils, totalFils, turnaroundDays, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  'fake-order', pendingBid.requestId, pendingBid.id, pendingBid.request.customerId, pendingBid.tailorId, 'no-payment',
  pendingBid.upfrontFils, pendingBid.completionFils, pendingBid.totalFils, 7, 'ACCEPTED', now, now,
)
await expectBlocked('promote a customer to TAILOR', 'UPDATE "User" SET role = ? WHERE id = ?', 'TAILOR', customer.id)
await expectBlocked(
  'insert a payment that is already PAID',
  'INSERT INTO "Payment" (id, kind, status, amountFils, currency, customerId, requestId, bidId, bidVersion, expiresAt, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  'fake-pay', 'UPFRONT', 'PAID', pendingBid.upfrontFils, 'KWD', pendingBid.request.customerId, pendingBid.requestId, pendingBid.id, 1, now, now, now,
)
await expectBlocked('bid whose total does not add up', 'UPDATE "Bid" SET totalFils = 5 WHERE id = ?', pendingBid.id)
await expectBlocked(
  'message from someone outside the order',
  'INSERT INTO "Message" (orderId, senderId, body, createdAt) VALUES (?,?,?,?)',
  inProgress.id, outsider.id, 'hi', now,
)

await db.$disconnect()
console.log(failures ? `\n${failures} write(s) were NOT blocked` : '\nAll illegal writes were blocked by the database.')
process.exit(failures ? 1 : 0)
