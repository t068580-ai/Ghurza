// Demo data that shows every state of the system. Run with `npm run db:reset`
// (drops the database, re-applies migrations + triggers, then runs this file).
//
// Everything here goes through the same SQLite triggers as the app, so the seed
// can only create histories that the real flow could have produced: payments are
// created PENDING then marked PAID, orders only exist after a PAID upfront payment,
// and they move forward one step at a time.

import { PrismaClient } from '@prisma/client'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { hashPassword } from '../lib/password'

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed a production database.')
  process.exit(1)
}

const db = new PrismaClient()
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')
const DAY = 86400000
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3600000)
const kwd = (n: number) => Math.round(n * 1000)

// ---------------------------------------------------------------- tiny PNG writer
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf: Buffer) {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
type RGB = [number, number, number]
// Draws a simple garment silhouette (body, sleeves, trim) on a soft background.
function garmentPng(body: RGB, trim: RGB, bg: RGB, w = 300, h = 400): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  const cx = w / 2
  const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
  }
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const fy = y / h
      let c: RGB = [bg[0] - fy * 12, bg[1] - fy * 12, bg[2] - fy * 12] as RGB
      const inBody = fy > 0.14 && fy < 0.95 && Math.abs(x - cx) < w * (0.085 + (fy - 0.14) * 0.17)
      const inSleeve =
        fy > 0.14 &&
        (segDist(x, y, cx - w * 0.08, h * 0.17, cx - w * 0.29, h * 0.55) < w * 0.045 ||
          segDist(x, y, cx + w * 0.08, h * 0.17, cx + w * 0.29, h * 0.55) < w * 0.045)
      if (inBody || inSleeve) c = body
      if (inBody && (fy > 0.925 || (Math.abs(x - cx) < 2.5 && fy < 0.48))) c = trim
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = Math.max(0, Math.min(255, c[0]))
      raw[o + 1] = Math.max(0, Math.min(255, c[1]))
      raw[o + 2] = Math.max(0, Math.min(255, c[2]))
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

async function storeUpload(ownerId: string, kind: 'REQUEST_REFERENCE' | 'ORDER_FINISHED', png: Buffer) {
  mkdirSync(UPLOAD_DIR, { recursive: true })
  const storedName = `${randomUUID()}.png`
  writeFileSync(path.join(UPLOAD_DIR, storedName), png, { flag: 'wx' })
  return db.upload.create({
    data: {
      ownerId,
      kind,
      storedName,
      mimeType: 'image/png',
      sizeBytes: png.length,
      width: 300,
      height: 400,
      sha256: createHash('sha256').update(png).digest('hex'),
    },
  })
}

// ---------------------------------------------------------------- helpers mirroring the app's flow
const credentials: string[] = []

async function user(email: string, displayName: string, role: 'CUSTOMER' | 'TAILOR', bio = '', city = '') {
  // Random per-install demo passwords, written to a gitignored file. No shared
  // password is hard-coded in the repository.
  const password = randomBytes(12).toString('base64url')
  credentials.push(`${role.padEnd(8)}  ${email.padEnd(24)}  ${password}`)
  const u = await db.user.create({
    data: { email, displayName, role, passwordHash: await hashPassword(password), createdAt: ago(60) },
  })
  if (role === 'TAILOR') await db.tailorProfile.create({ data: { userId: u.id, bio, city } })
  return u
}

async function request(customerId: string, data: { title: string; pieceType: string; description: string; min?: number; max?: number; neededInDays?: number; daysAgo: number; photo?: Buffer }) {
  const photo = data.photo ? await storeUpload(customerId, 'REQUEST_REFERENCE', data.photo) : null
  return db.request.create({
    data: {
      customerId,
      title: data.title,
      pieceType: data.pieceType,
      description: data.description,
      budgetMinFils: data.min != null ? kwd(data.min) : null,
      budgetMaxFils: data.max != null ? kwd(data.max) : null,
      neededBy: data.neededInDays ? new Date(Date.now() + data.neededInDays * DAY) : null,
      referencePhotoId: photo?.id ?? null,
      createdAt: ago(data.daysAgo),
    },
  })
}

type Version = { up: number; done: number; days: number; note?: string; daysAgo: number }

// Places a bid and replays its revision history. `declineBefore` lists revision
// numbers that the customer declined just before the tailor revised again.
async function bidWithHistory(requestId: string, tailorId: string, versions: Version[], opts: { declineBefore?: number[]; endDeclined?: boolean } = {}) {
  const [first, ...rest] = versions
  const bid = await db.bid.create({
    data: {
      requestId,
      tailorId,
      upfrontFils: kwd(first.up),
      completionFils: kwd(first.done),
      totalFils: kwd(first.up + first.done),
      turnaroundDays: first.days,
      note: first.note ?? null,
      createdAt: ago(first.daysAgo),
    },
  })
  await db.bidRevision.create({
    data: { bidId: bid.id, revisionNo: 1, upfrontFils: kwd(first.up), completionFils: kwd(first.done), totalFils: kwd(first.up + first.done), turnaroundDays: first.days, note: first.note ?? null, statusBefore: 'NEW', createdAt: ago(first.daysAgo) },
  })
  let version = 1
  for (const v of rest) {
    let statusBefore = 'PENDING'
    if (opts.declineBefore?.includes(version + 1)) {
      await db.bid.update({ where: { id: bid.id }, data: { status: 'DECLINED', declinedAt: ago(v.daysAgo, 2) } })
      statusBefore = 'DECLINED'
    }
    version++
    await db.bid.update({
      where: { id: bid.id },
      data: { upfrontFils: kwd(v.up), completionFils: kwd(v.done), totalFils: kwd(v.up + v.done), turnaroundDays: v.days, note: v.note ?? null, status: 'PENDING', declinedAt: null, version },
    })
    await db.bidRevision.create({
      data: { bidId: bid.id, revisionNo: version, upfrontFils: kwd(v.up), completionFils: kwd(v.done), totalFils: kwd(v.up + v.done), turnaroundDays: v.days, note: v.note ?? null, statusBefore, createdAt: ago(v.daysAgo) },
    })
  }
  if (opts.endDeclined) await db.bid.update({ where: { id: bid.id }, data: { status: 'DECLINED', declinedAt: ago(0, 5) } })
  return db.bid.findUniqueOrThrow({ where: { id: bid.id } })
}

// Same steps as lib/payments/settle.ts, so the triggers accept them.
async function awardWithPaidDeposit(requestId: string, bidId: string, customerId: string, daysAgo: number) {
  const bid = await db.bid.findUniqueOrThrow({ where: { id: bidId } })
  const pay = await db.payment.create({
    data: { kind: 'UPFRONT', amountFils: bid.upfrontFils, customerId, requestId, bidId, bidVersion: bid.version, expiresAt: new Date(Date.now() + 1800000), createdAt: ago(daysAgo) },
  })
  await db.payment.update({ where: { id: pay.id }, data: { status: 'PAID', paidAt: ago(daysAgo), providerRef: `mock_${randomUUID()}` } })
  await db.request.update({ where: { id: requestId }, data: { status: 'AWARDED', awardedAt: ago(daysAgo) } })
  await db.bid.update({ where: { id: bidId }, data: { status: 'ACCEPTED' } })
  await db.bid.updateMany({ where: { requestId, id: { not: bidId }, status: { in: ['PENDING', 'DECLINED'] } }, data: { status: 'LOST' } })
  const order = await db.order.create({
    data: {
      requestId,
      bidId,
      customerId,
      tailorId: bid.tailorId,
      upfrontPaymentId: pay.id,
      upfrontFils: bid.upfrontFils,
      completionFils: bid.completionFils,
      totalFils: bid.totalFils,
      turnaroundDays: bid.turnaroundDays,
      createdAt: ago(daysAgo),
    },
  })
  await db.payment.update({ where: { id: pay.id }, data: { orderId: order.id } })
  return order
}

async function advance(orderId: string, to: 'IN_PROGRESS' | 'READY', daysAgo: number) {
  await db.order.update({ where: { id: orderId }, data: to === 'IN_PROGRESS' ? { status: to, startedAt: ago(daysAgo) } : { status: to, readyAt: ago(daysAgo) } })
}

async function completeWithPaidBalance(orderId: string, daysAgo: number) {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { bid: true } })
  const pay = await db.payment.create({
    data: { kind: 'COMPLETION', amountFils: o.completionFils, customerId: o.customerId, requestId: o.requestId, bidId: o.bidId, bidVersion: o.bid.version, orderId, expiresAt: new Date(Date.now() + 1800000), createdAt: ago(daysAgo) },
  })
  await db.payment.update({ where: { id: pay.id }, data: { status: 'PAID', paidAt: ago(daysAgo), providerRef: `mock_${randomUUID()}` } })
  await db.order.update({ where: { id: orderId }, data: { status: 'COMPLETED', completedAt: ago(daysAgo), completionPaymentId: pay.id } })
}

async function chat(orderId: string, lines: [string, string, number][]) {
  for (const [senderId, body, hoursAgo] of lines) {
    await db.message.create({ data: { orderId, senderId, body, createdAt: new Date(Date.now() - hoursAgo * 3600000) } })
  }
}

async function finishedPhoto(orderId: string, tailorId: string, png: Buffer) {
  const up = await storeUpload(tailorId, 'ORDER_FINISHED', png)
  await db.orderPhoto.create({ data: { orderId, uploadId: up.id, inPortfolio: true } })
}

// ---------------------------------------------------------------- the story
async function main() {
  if ((await db.user.count()) > 0) {
    console.error('Database already has data. Run `npm run db:reset` to start fresh.')
    process.exit(1)
  }

  const amal = await user('amal@ghurza.test', 'Amal Al-Enezi', 'CUSTOMER')
  const fajer = await user('fajer@ghurza.test', 'Fajer Al-Kandari', 'CUSTOMER')
  const reem = await user('reem@ghurza.test', 'Reem Al-Shatti', 'CUSTOMER')
  const badria = await user('badria@ghurza.test', 'Badria Al-Hajri', 'TAILOR', 'Bridal and evening wear for fifteen years. Silk, chiffon and hand-beading.', 'Salmiya')
  const khaled = await user('khaled@ghurza.test', 'Khaled Al-Mutawa', 'TAILOR', 'Bishts, dishdashas and formal menswear. Zari work done in-house.', 'Kuwait City')
  const maha = await user('maha@ghurza.test', 'Maha Al-Rumaihi', 'TAILOR', 'Everyday and occasion abayas, quick alterations.', 'Jabriya')

  // 1. Amal: an OPEN request with three bids — the accept-and-pay flow.
  //    Badria's bid was declined, then revised (soft decline), with full history.
  const bisht = await request(amal.id, {
    title: 'Navy bisht with gold zari for graduation',
    pieceType: 'BISHT',
    description: 'Lightweight navy wool bisht, gold zari along the front edges and shoulders. Ceremony is outdoors in late spring, so it should breathe.',
    min: 120,
    max: 260,
    neededInDays: 40,
    daysAgo: 6,
    photo: garmentPng([24, 36, 72], [200, 160, 60], [242, 238, 230]),
  })
  await bidWithHistory(bisht.id, khaled.id, [
    { up: 90, done: 140, days: 21, note: 'Hand-stitched zari. I keep navy wool in stock.', daysAgo: 5 },
    { up: 85, done: 130, days: 18, note: 'Can start this week, so a few days faster.', daysAgo: 3 },
  ])
  await bidWithHistory(
    bisht.id,
    badria.id,
    [
      { up: 110, done: 170, days: 14, note: 'Silk-blend lining for comfort in the heat.', daysAgo: 5 },
      { up: 95, done: 150, days: 14, note: 'Revised after your decline: same lining, machine zari on the shoulders brings it down.', daysAgo: 2 },
    ],
    { declineBefore: [2] },
  )
  await bidWithHistory(bisht.id, maha.id, [{ up: 100, done: 155, days: 12, note: 'Bishts are not my main line, but the finish will be clean.', daysAgo: 4 }])

  // 2. Reem: an OPEN request with zero bids — the honest empty state.
  await request(reem.id, {
    title: 'Take in a beaded wedding dress',
    pieceType: 'ALTERATIONS',
    description: 'Taking in the bodice by about two sizes and shortening the hem. The dress is beaded, so it needs care.',
    neededInDays: 25,
    daysAgo: 1,
  })

  // 3. Fajer: two COMPLETED orders with chat, finished photos and reviews.
  const gown = await request(fajer.id, {
    title: 'Emerald silk evening gown for Eid',
    pieceType: 'EVENING_GOWN',
    description: 'Floor length, emerald silk, long sleeves, a little structure at the waist. Simple neckline.',
    min: 150,
    max: 280,
    daysAgo: 40,
  })
  const gownBid = await bidWithHistory(gown.id, badria.id, [
    { up: 70, done: 160, days: 21, daysAgo: 39 },
    { up: 60, done: 140, days: 21, note: 'Sourced the silk locally, so lower.', daysAgo: 38 },
  ])
  await bidWithHistory(gown.id, maha.id, [{ up: 80, done: 150, days: 18, daysAgo: 39 }])
  const gownOrder = await awardWithPaidDeposit(gown.id, gownBid.id, fajer.id, 37)
  await chat(gownOrder.id, [
    [fajer.id, 'Hi Badria! Deposit paid, so excited for this one.', 37 * 24],
    [badria.id, 'Thank you! I will order the silk tomorrow. Could you come in this week for measurements?', 37 * 24 - 2],
    [fajer.id, 'Thursday afternoon?', 37 * 24 - 3],
    [badria.id, 'Thursday at 4 works. Salem Al-Mubarak Street, above the fabric shop.', 37 * 24 - 4],
    [badria.id, 'Finished this morning, photos are on the order. The hem sits just off the floor as you wanted.', 16 * 24],
    [fajer.id, 'It is beautiful. Paying the balance now.', 15 * 24],
  ])
  await advance(gownOrder.id, 'IN_PROGRESS', 34)
  await finishedPhoto(gownOrder.id, badria.id, garmentPng([18, 98, 66], [214, 190, 120], [245, 241, 233]))
  await advance(gownOrder.id, 'READY', 16)
  await completeWithPaidBalance(gownOrder.id, 15)
  await db.review.create({
    data: { orderId: gownOrder.id, customerId: fajer.id, tailorId: badria.id, rating: 5, text: 'The fit was exact and the finishing is beautiful. Worth every fils.', createdAt: ago(14) },
  })

  const dish = await request(fajer.id, {
    title: 'Summer linen dishdasha for my father',
    pieceType: 'DISHDASHA',
    description: 'White linen, Kuwaiti collar, two side pockets. He prefers it a little loose.',
    min: 30,
    max: 60,
    daysAgo: 30,
  })
  const dishBid = await bidWithHistory(dish.id, khaled.id, [{ up: 20, done: 28, days: 8, note: 'Japanese linen, very cool in summer.', daysAgo: 29 }])
  const dishOrder = await awardWithPaidDeposit(dish.id, dishBid.id, fajer.id, 28)
  await chat(dishOrder.id, [
    [khaled.id, 'Received. Please send his collar size and preferred length.', 28 * 24 - 1],
    [fajer.id, 'Collar 41, length 150 cm. Thank you!', 28 * 24 - 3],
  ])
  await advance(dishOrder.id, 'IN_PROGRESS', 27)
  await finishedPhoto(dishOrder.id, khaled.id, garmentPng([236, 236, 230], [205, 205, 198], [214, 222, 232]))
  await advance(dishOrder.id, 'READY', 20)
  await completeWithPaidBalance(dishOrder.id, 19)
  await db.review.create({
    data: { orderId: dishOrder.id, customerId: fajer.id, tailorId: khaled.id, rating: 4, text: 'Very good linen and quick work. The collar was a touch tight, fixed the same day.', createdAt: ago(18) },
  })

  // 4. Amal: an order IN_PROGRESS, to show the middle of the lifecycle and live chat.
  const abaya = await request(amal.id, {
    title: 'Black everyday abaya with embroidered cuffs',
    pieceType: 'ABAYA',
    description: 'Light crepe, open front with hidden snaps, tone-on-tone embroidery on the cuffs only.',
    min: 40,
    max: 90,
    daysAgo: 12,
  })
  const abayaBid = await bidWithHistory(abaya.id, maha.id, [{ up: 25, done: 45, days: 10, note: 'Crepe from my usual supplier; embroidery by hand.', daysAgo: 11 }])
  await bidWithHistory(abaya.id, badria.id, [{ up: 40, done: 60, days: 9, daysAgo: 11 }])
  const abayaOrder = await awardWithPaidDeposit(abaya.id, abayaBid.id, amal.id, 9)
  await advance(abayaOrder.id, 'IN_PROGRESS', 8)
  await chat(abayaOrder.id, [
    [maha.id, 'Deposit received, thank you. Do you want the snaps in black or gold?', 9 * 24 - 1],
    [amal.id, 'Black please, and a little longer than standard if possible.', 9 * 24 - 2],
    [maha.id, 'Noted: black snaps, +3 cm. Cuffs are being embroidered now.', 30],
  ])

  const out = path.resolve(process.cwd(), 'prisma', 'demo-credentials.txt')
  writeFileSync(
    out,
    ['Ghurza demo accounts (generated by the seed; this file is gitignored).', 'Each `npm run db:reset` generates new passwords.', '', ...credentials, ''].join('\n'),
  )
  console.log(`Seeded 6 users, 5 requests, 3 orders. Demo passwords written to ${path.relative(process.cwd(), out)}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
