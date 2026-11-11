import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../env'

// Provider callbacks carry a header like:  t=1731300000,v1=<64 hex>
// v1 = HMAC-SHA256(secret, "v1." + t + "." + rawBody)
// Signing the RAW body (not a re-serialized object) means nothing in the body can be
// changed without breaking the signature. The timestamp limits replays to 5 minutes.

const WINDOW_SECONDS = 300

function mac(t: number, rawBody: string): string {
  const key = Buffer.from(env().PAYMENT_WEBHOOK_SECRET, 'hex')
  return createHmac('sha256', key).update(`v1.${t}.${rawBody}`).digest('hex')
}

export function signEvent(rawBody: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  return `t=${nowSeconds},v1=${mac(nowSeconds, rawBody)}`
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'mismatch' }

export function verifyEvent(rawBody: string, header: string | null, nowSeconds = Math.floor(Date.now() / 1000)): VerifyResult {
  if (!header) return { ok: false, reason: 'missing' }
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header.trim())
  if (!m) return { ok: false, reason: 'malformed' }
  const t = Number(m[1])
  if (Math.abs(nowSeconds - t) > WINDOW_SECONDS) return { ok: false, reason: 'stale' }
  const expected = Buffer.from(mac(t, rawBody), 'hex')
  const given = Buffer.from(m[2], 'hex')
  // Constant-time compare so the check doesn't leak how many bytes matched.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'mismatch' }
  return { ok: true }
}
