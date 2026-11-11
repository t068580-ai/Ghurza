import 'server-only'
import { headers } from 'next/headers'
import { db } from './db'
import { env } from './env'

export const AUDIT_ACTIONS = [
  'SIGNUP',
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'RATE_LIMITED',
  'AUTHZ_DENIED',
  'CSRF_REJECTED',
  'REQUEST_CREATED',
  'REQUEST_CANCELLED',
  'BID_PLACED',
  'BID_REVISED',
  'BID_DECLINED',
  'PAYMENT_CREATED',
  'PAYMENT_PAID',
  'PAYMENT_FAILED',
  'PAYMENT_REFUND_DUE',
  'PAYMENT_BAD_SIGNATURE',
  'PAYMENT_AMOUNT_MISMATCH',
  'ORDER_CREATED',
  'ORDER_TRANSITION',
  'REVIEW_CREATED',
  'UPLOAD_REJECTED',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

type Detail = Record<string, string | number | boolean | null>

// Only these keys may appear in a detail object. Anything else is dropped, so a
// careless call can't log a password, token, cookie, signature or message body.
const SAFE_KEYS = new Set(['reason', 'status', 'from', 'to', 'kind', 'amountFils', 'role', 'outcome', 'count', 'event'])

// The client IP is only read from X-Forwarded-For when the app is explicitly told
// it sits behind exactly one trusted reverse proxy. Even then we take the
// RIGHT-most entry: that is the address our proxy appended. Entries to its left
// were sent by the client and can be anything, so using the left-most value
// would let an attacker pick a fresh "IP" for every request.
// Without a trusted proxy, Server Actions can't see the client address, so this
// returns null and per-IP limits are skipped (per-account limits still apply).
export async function clientIp(): Promise<string | null> {
  try {
    const h = await headers()
    if (env().TRUST_PROXY === 'true') {
      const hops = (h.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      const last = hops.at(-1)
      if (last) return last.slice(0, 64)
    }
    return null
  } catch {
    return null
  }
}

export async function audit(
  action: AuditAction,
  opts: { userId?: string | null; entity?: string; entityId?: string; detail?: Detail } = {},
): Promise<void> {
  const detail = opts.detail
    ? JSON.stringify(Object.fromEntries(Object.entries(opts.detail).filter(([k]) => SAFE_KEYS.has(k))))
    : null
  const ip = await clientIp()
  const line = { audit: action, userId: opts.userId ?? null, entity: opts.entity ?? null, entityId: opts.entityId ?? null, ip, detail }
  console.log(JSON.stringify(line))
  try {
    await db.auditLog.create({
      data: {
        action,
        userId: opts.userId ?? null,
        entity: opts.entity ?? null,
        entityId: opts.entityId ?? null,
        ip,
        detail: detail?.slice(0, 500) ?? null,
      },
    })
  } catch {
    // Logging must never break the request it describes.
  }
}
