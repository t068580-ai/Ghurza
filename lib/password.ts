// No 'server-only' guard: the seed script (plain Node via tsx) imports this file too.
// It can never reach the browser because it depends on node:crypto.
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto'

// scrypt cost. Parameters are stored inside each hash, so they can be raised later
// and old hashes are upgraded on the next successful login (needsRehash).
const PARAMS = { N: 32768, r: 8, p: 3 }
const KEYLEN = 64
const MAXMEM = 64 * 1024 * 1024

// At most 2 password hashes run at once; up to 100 more wait in line, and anything
// beyond that is refused. Node's worker-thread pool has 4 threads by default
// (UV_THREADPOOL_SIZE) and also serves file reads, crypto and zlib, so keeping
// scrypt to 2 leaves half the pool free: a login flood slows logins down but
// can't stall the rest of the app. (An earlier version used 4, i.e. the whole
// pool. OWASP audit finding.)
// What this does NOT stop: a flood can still fill the login queue for everyone.
// Per-client limits need the real client IP, which only a trusted reverse proxy can
// supply (TRUST_PROXY=true). See DESIGN.md §13.
const MAX_CONCURRENT = 2
const MAX_QUEUE = 100
let active = 0
const waiting: (() => void)[] = []

export class PasswordCheckBusyError extends Error {}

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active < MAX_CONCURRENT) {
    active++
  } else {
    if (waiting.length >= MAX_QUEUE) throw new PasswordCheckBusyError('too many password checks in progress')
    await new Promise<void>((resolve) => waiting.push(resolve)) // the slot is handed over, not re-counted
  }
  try {
    return await fn()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
}

function run(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return withSlot(
    () =>
      new Promise((resolve, reject) => {
        scrypt(password, salt, KEYLEN, { N, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)))
      }),
  )
}

function parse(stored: string) {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const [N, r, p] = parts.slice(1, 4).map(Number)
  // Bound the parameters so a corrupted row can't make one login burn the CPU.
  if (![N, r, p].every(Number.isInteger) || N < 1024 || N > 1 << 17 || r < 1 || r > 16 || p < 1 || p > 8) return null
  return { N, r, p, salt: Buffer.from(parts[4], 'base64url'), key: Buffer.from(parts[5], 'base64url') }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await run(password.normalize('NFKC'), salt, PARAMS.N, PARAMS.r, PARAMS.p)
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const h = parse(stored)
  if (!h || h.key.length !== KEYLEN) return false
  const actual = await run(password.normalize('NFKC'), h.salt, h.N, h.r, h.p)
  return timingSafeEqual(actual, h.key)
}

export function needsRehash(stored: string): boolean {
  const h = parse(stored)
  return !h || h.N !== PARAMS.N || h.r !== PARAMS.r || h.p !== PARAMS.p
}

// When a login email doesn't exist we still run one full scrypt, so the response
// time doesn't reveal which emails have accounts (user enumeration).
let dummyHash: Promise<string> | null = null
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'))
  await verifyPassword(password, await dummyHash)
}

// A short list of the most common passwords. A real deployment would use a much
// larger list (or a k-anonymity breach check); this shows where the check lives.
const COMMON = new Set([
  '123456789012', 'password1234', 'qwertyuiop12', 'iloveyou1234', 'administrator',
  'passwordpassword', '111111111111', '000000000000', 'abc123abc123', 'qwerty123456',
  'letmein12345', 'welcome12345', 'password12345', '1234567890123', 'kuwait123456',
])

// Returns an error message, or null when the password is acceptable.
// Policy follows NIST SP 800-63B: length over composition rules.
export function passwordProblem(password: string, email: string): string | null {
  const pw = password.normalize('NFKC')
  if (pw.length < 12) return 'Use at least 12 characters.'
  if (pw.length > 128) return 'Use at most 128 characters.'
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common.'
  const local = email.split('@')[0]?.toLowerCase() ?? ''
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return "Don't include your email name in the password."
  return null
}
