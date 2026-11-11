// Creates or repairs .env before `npm run dev`, so a fresh clone works on Windows
// with no manual steps. Generates a unique payment-signing secret per install;
// the secret is never committed (.env is gitignored).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const path = '.env'
const current = existsSync(path) ? readFileSync(path, 'utf8') : ''
const lines = current.split(/\r?\n/).filter((l) => l.trim() !== '')
const has = (k) => lines.some((l) => l.startsWith(`${k}=`))
const get = (k) => lines.find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).replace(/^"|"$/g, '')

// Local development only: the mock checkout is enabled so the demo works without
// a real payment provider. The app refuses to start with it on when NODE_ENV=production.
const defaults = {
  DATABASE_URL: 'file:./dev.db',
  APP_ORIGIN: 'http://localhost:3000',
  MOCK_PAYMENTS: 'true',
  TRUST_PROXY: 'false',
}

if (process.env.NODE_ENV === 'production') {
  console.error('[ensure-env] refusing to generate a development .env with NODE_ENV=production')
  process.exit(1)
}

let changed = false
for (const [k, v] of Object.entries(defaults)) {
  if (!has(k)) {
    lines.push(`${k}="${v}"`)
    changed = true
  }
}

const secret = get('PAYMENT_WEBHOOK_SECRET')
if (!secret || !/^[0-9a-f]{64}$/.test(secret)) {
  const fresh = randomBytes(32).toString('hex')
  const i = lines.findIndex((l) => l.startsWith('PAYMENT_WEBHOOK_SECRET='))
  if (i >= 0) lines[i] = `PAYMENT_WEBHOOK_SECRET="${fresh}"`
  else lines.push(`PAYMENT_WEBHOOK_SECRET="${fresh}"`)
  changed = true
}

if (changed) {
  writeFileSync(path, lines.join('\n') + '\n')
  console.log('[ensure-env] wrote .env (secret generated locally, not committed)')
}
mkdirSync('uploads', { recursive: true })
