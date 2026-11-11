// Security self-test for the fixes from the independent review.
// Run: npm run test:security   (needs a seeded dev database for the rate-limit test)
//
// Uses --conditions=react-server so that `import 'server-only'` resolves to its
// empty server build instead of throwing outside Next.js.

import { deflateSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'

process.loadEnvFile('.env')

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
}

async function main() {
  // ---------------------------------------------------------------- 1. mock payments can't be on in production
  {
    const e = process.env as Record<string, string | undefined>
    const saved = { NODE_ENV: e.NODE_ENV, MOCK: e.MOCK_PAYMENTS }
    const { env } = await import('../lib/env')
    Object.assign(e, { NODE_ENV: 'production', MOCK_PAYMENTS: 'true' })
    let threw = false
    try {
      env()
    } catch {
      threw = true
    }
    check('app refuses to start with MOCK_PAYMENTS=true in production', threw)
    e.NODE_ENV = saved.NODE_ENV ?? 'development'
    delete e.MOCK_PAYMENTS
    check('MOCK_PAYMENTS defaults to off when unset', env().MOCK_PAYMENTS === 'false')
    if (saved.MOCK) e.MOCK_PAYMENTS = saved.MOCK
  }

  // ---------------------------------------------------------------- 2. image metadata stripping
  const { inspectImage } = await import('../lib/image')
  {
    // A real 16x16 JPEG (JFIF), then hostile extras added around it.
    const base = Buffer.from(
      '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDABwTFRgVERwYFhgfHRwhKUUtKSYmKVQ8QDJFZFhpZ2JYYF9ufJ6GbnWWd19giruLlqOpsbOxa4TC0MGszp6usar/2wBDAR0fHykkKVEtLVGqcmByqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqr/wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDGoooroMz/2Q==',
      'base64',
    )
    const seg = (marker: number, payload: string) => {
      const p = Buffer.from(payload, 'latin1')
      const h = Buffer.from([0xff, marker, 0, 0])
      h.writeUInt16BE(p.length + 2, 2)
      return Buffer.concat([h, p])
    }
    const sos = base.indexOf(Buffer.from([0xff, 0xda]))
    const hostile = Buffer.concat([
      base.subarray(0, 2),
      seg(0xe1, 'Exif\0\0GPS 29.37N 47.97E SECRET-EXIF-GPS'),
      base.subarray(2, sos),
      seg(0xfe, 'SECRET-COMMENT'),
      seg(0xe2, 'MPF\0SECRET-SECOND-IMAGE'),
      base.subarray(sos),
      Buffer.from('....ftypmp42 SECRET-MOTION-PHOTO-VIDEO', 'latin1'),
    ])
    const r = inspectImage(hostile)
    const s = r?.clean.toString('latin1') ?? ''
    const left = ['SECRET-EXIF-GPS', 'SECRET-COMMENT', 'SECRET-SECOND-IMAGE', 'SECRET-MOTION-PHOTO-VIDEO'].filter((x) => s.includes(x))
    check('JPEG: EXIF/GPS, comment, extra image and appended video all removed', !!r && left.length === 0, left.join(', '))
    check('JPEG: cleaned file still starts with SOI and ends with EOI', !!r && s.startsWith('\xff\xd8') && r.clean.subarray(-2).toString('hex') === 'ffd9')
    check('JPEG: dimensions read from the frame header', r?.width === 16 && r?.height === 16, `${r?.width}x${r?.height}`)
    check('JPEG: truncated file rejected', inspectImage(hostile.subarray(0, sos + 20)) === null)
  }
  {
    const crcT = new Uint32Array(256).map((_, n) => {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      return c >>> 0
    })
    const crc = (b: Buffer) => {
      let c = 0xffffffff
      for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8)
      return (c ^ 0xffffffff) >>> 0
    }
    const chunk = (type: string, data: Buffer) => {
      const l = Buffer.alloc(4)
      l.writeUInt32BE(data.length)
      const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
      const c = Buffer.alloc(4)
      c.writeUInt32BE(crc(td))
      return Buffer.concat([l, td, c])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(4, 0)
    ihdr.writeUInt32BE(4, 4)
    ihdr[8] = 8
    ihdr[9] = 2
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('tEXt', Buffer.from('Comment\0SECRET-TEXT')),
      chunk('prVt', Buffer.from('SECRET-PRIVATE-CHUNK')),
      chunk('iCCP', Buffer.from('profile\0\0SECRET-ICC')),
      chunk('IDAT', deflateSync(Buffer.alloc((4 * 3 + 1) * 4))),
      chunk('IEND', Buffer.alloc(0)),
      Buffer.from('SECRET-AFTER-IEND'),
    ])
    const r = inspectImage(png)
    const s = r?.clean.toString('latin1') ?? ''
    const left = ['SECRET-TEXT', 'SECRET-PRIVATE-CHUNK', 'SECRET-ICC', 'SECRET-AFTER-IEND'].filter((x) => s.includes(x))
    check('PNG: text, private, ICC chunks and trailing data removed (allowlist)', !!r && left.length === 0, left.join(', '))
    check('HTML disguised as an image rejected', inspectImage(Buffer.from('<html><script>alert(1)</script></html>')) === null)
  }

  // ---------------------------------------------------------------- 3. blind-bid ranges
  {
    const { totalBand, turnaroundBand, MAX_TOTAL_FILS } = await import('../lib/bids')
    const b = totalBand(245_000)
    check('lowest total is shown as a range, not the exact figure', b.fromFils === 200_000 && b.toFils === 299_999, `${b.fromFils / 1000}–${(b.toFils + 1) / 1000} KWD`)
    // The audit showed a value-dependent band could be decoded back to ~5 KWD. With
    // fixed edges, every total inside a band must give byte-identical output, so the
    // output carries no information beyond the band itself.
    // Totals run from 2 KWD (1 + 1) to MAX_TOTAL_FILS (10,000 + 10,000). Every band,
    // including the open-ended top one, is checked over that whole range.
    const MIN_TOTAL_FILS = 2_000
    const seen = new Map<string, { outputs: Set<string>; lo: number; hi: number }>()
    let outside = 0
    for (let fils = MIN_TOTAL_FILS; fils <= MAX_TOTAL_FILS; fils += 500) {
      const out = totalBand(fils)
      const openEnded = out.toFils === out.fromFils
      if (fils < out.fromFils || (!openEnded && fils > out.toFils)) outside++
      const k = `${out.fromFils}`
      const s = seen.get(k) ?? { outputs: new Set<string>(), lo: fils, hi: fils }
      s.outputs.add(JSON.stringify(out))
      s.hi = fils
      seen.set(k, s)
    }
    const bands = [...seen.values()]
    const variable = bands.filter((s) => s.outputs.size > 1).length
    check('every total inside a band produces the identical range (nothing to decode)', outside === 0 && variable === 0, `${bands.length} bands, 2–20,000 KWD`)
    // A band that can only hold one possible total would reveal that total. Require
    // every band to span at least 20 KWD of possible totals.
    const narrowest = Math.min(...bands.map((s) => s.hi - s.lo))
    check('every band, including the open-ended top one, spans at least 20 KWD of possible totals', narrowest >= 20_000, `narrowest ${narrowest / 1000} KWD`)
    check('fastest turnaround is shown as a band', turnaroundBand(12) === '1–2 weeks')
  }

  // ---------------------------------------------------------------- 4. rate limiter under a parallel burst
  {
    const { consume, reset } = await import('../lib/rate-limit')
    const key = `selftest:${randomUUID()}`
    const results = await Promise.all(Array.from({ length: 40 }, () => consume(key, 5, 60_000)))
    const allowed = results.filter(Boolean).length
    check('40 parallel attempts against a limit of 5: exactly 5 allowed', allowed === 5, `${allowed} allowed`)
    await reset(key)

    // The audit's rollover case: the window has just EXPIRED when a burst arrives.
    // Every request sees the old window; only one may restart it.
    const { db } = await import('../lib/db')
    const rollKey = `selftest:${randomUUID()}`
    await db.rateLimit.create({ data: { key: rollKey, count: 5, windowStart: new Date(Date.now() - 2 * 3_600_000) } })
    const rolled = await Promise.all(Array.from({ length: 40 }, () => consume(rollKey, 5, 60_000)))
    const rolledAllowed = rolled.filter(Boolean).length
    check('burst of 40 right after the window expires: still at most 5 allowed', rolledAllowed <= 5 && rolledAllowed >= 1, `${rolledAllowed} allowed`)
    await reset(rollKey)
    await db.$disconnect()
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll security self-tests passed.')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
