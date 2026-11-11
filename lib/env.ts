import 'server-only'
import { z } from 'zod'

// Every environment variable the server relies on is validated once.
// A missing or placeholder secret stops the app instead of running insecurely.
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PAYMENT_WEBHOOK_SECRET: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'must be 64 hex characters (run "npm run dev" once to generate .env)'),
  APP_ORIGIN: z.url().transform((u) => new URL(u).origin),
  // Off unless explicitly turned on. The mock checkout lets any customer "approve"
  // their own payment, so it must never be on by accident.
  MOCK_PAYMENTS: z.enum(['true', 'false']).default('false'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
}).refine((e) => !(e.NODE_ENV === 'production' && e.MOCK_PAYMENTS === 'true'), {
  message: 'MOCK_PAYMENTS must not be "true" in production: anyone could approve their own payments.',
  path: ['MOCK_PAYMENTS'],
})

export type Env = z.infer<typeof schema>
let cached: Env | null = null

export function env(): Env {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid environment configuration. ${problems}`)
  }
  cached = parsed.data
  return cached
}
