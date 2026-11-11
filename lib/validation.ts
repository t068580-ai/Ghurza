import { z } from 'zod'
import { PIECE_TYPES, ROLES } from './enums'
import { parseKWDToFils } from './money'

// Every input from the browser goes through one of these schemas. All object
// schemas are strict: an unexpected field (customerId, status, amountFils, role on
// login...) makes the whole submission invalid. That blocks mass assignment.

export const idSchema = z.string().regex(/^[a-z0-9]{20,32}$/, 'Invalid id.')

// Turns FormData into a plain object of strings. Skips Next.js's internal
// $ACTION_* fields and File values (files are read separately). A repeated key
// is treated as tampering.
export function parseForm<T extends z.ZodType>(
  schema: T,
  fd: FormData,
): { ok: true; data: z.output<T> } | { ok: false; error: string } {
  const obj: Record<string, string> = {}
  for (const [key, value] of fd.entries()) {
    if (key.startsWith('$ACTION')) continue
    if (typeof value !== 'string') continue
    if (key in obj) return { ok: false, error: 'Invalid form submission.' }
    obj[key] = value
  }
  const parsed = schema.safeParse(obj)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    if (first?.code === 'unrecognized_keys') return { ok: false, error: 'Invalid form submission.' }
    return { ok: false, error: first?.message ?? 'Please check the form.' }
  }
  return { ok: true, data: parsed.data }
}

// Empty form fields arrive as "" — treat them as "not provided".
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (v === '' || v === undefined ? undefined : v), schema.optional())
}

function kwd(minFils: number, maxFils: number, label: string) {
  return z.string().transform((s, ctx) => {
    const fils = parseKWDToFils(s)
    if (fils === null) {
      ctx.addIssue({ code: 'custom', message: `${label}: enter an amount like 45 or 45.500.` })
      return z.NEVER
    }
    if (fils < minFils || fils > maxFils) {
      ctx.addIssue({ code: 'custom', message: `${label} must be between ${minFils / 1000} and ${maxFils / 1000} KWD.` })
      return z.NEVER
    }
    return fils
  })
}

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email.').max(254))
const displayName = z.string().trim().min(2, 'Name is too short.').max(60, 'Name is too long.')

// ---- Auth ------------------------------------------------------------------
export const signupSchema = z.strictObject({
  email,
  password: z.string().min(1, 'Enter a password.').max(256),
  displayName,
  role: z.enum(ROLES, 'Choose customer or tailor.'),
})

export const loginSchema = z.strictObject({
  email,
  password: z.string().min(1, 'Enter your password.').max(256),
})

// ---- Requests --------------------------------------------------------------
const neededBy = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date.')
  .transform((s, ctx) => {
    const d = new Date(`${s}T00:00:00.000Z`)
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const max = new Date(today.getTime() + 365 * 86400000)
    if (Number.isNaN(d.getTime()) || d <= today || d > max) {
      ctx.addIssue({ code: 'custom', message: 'Needed-by must be within the next year.' })
      return z.NEVER
    }
    return d
  })

export const requestSchema = z
  .strictObject({
    title: z.string().trim().min(3, 'Title is too short.').max(120, 'Title is too long.'),
    pieceType: z.enum(PIECE_TYPES, 'Choose a piece type.'),
    description: z.string().trim().min(10, 'Describe the piece in at least 10 characters.').max(4000),
    budgetMin: optional(kwd(0, 10_000_000, 'Budget from')),
    budgetMax: optional(kwd(0, 10_000_000, 'Budget to')),
    neededBy: optional(neededBy),
  })
  .refine((v) => v.budgetMin === undefined || v.budgetMax === undefined || v.budgetMax >= v.budgetMin, {
    message: '"Budget to" must be at least "Budget from".',
  })

export const requestIdSchema = z.strictObject({ requestId: idSchema })

// ---- Bids --------------------------------------------------------------------
const bidFields = {
  upfront: kwd(1_000, 10_000_000, 'Upfront payment'),
  completion: kwd(1_000, 10_000_000, 'Final payment'),
  turnaroundDays: z.coerce.number().int('Days must be a whole number.').min(1).max(365, 'At most 365 days.'),
  note: optional(z.string().trim().max(1000, 'Note is too long.')),
}

export const placeBidSchema = z.strictObject({ requestId: idSchema, ...bidFields })
export const reviseBidSchema = z.strictObject({
  bidId: idSchema,
  expectedVersion: z.coerce.number().int().min(1).max(100_000),
  ...bidFields,
})
export const bidIdSchema = z.strictObject({ bidId: idSchema })

// ---- Orders ------------------------------------------------------------------
export const orderIdSchema = z.strictObject({ orderId: idSchema })
export const photoSchema = z.strictObject({ orderId: idSchema, inPortfolio: optional(z.literal('on')) })

// Strip control characters (keep newline and tab) before measuring length.
export const messageSchema = z.strictObject({
  orderId: idSchema,
  body: z
    .string()
    .transform((s) => s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim())
    .pipe(z.string().min(1, 'Type a message.').max(2000, 'Message is too long.')),
})

export const reviewSchema = z.strictObject({
  orderId: idSchema,
  rating: z.coerce.number().int().min(1, 'Pick 1 to 5 stars.').max(5, 'Pick 1 to 5 stars.'),
  text: z.string().trim().min(10, 'Write at least 10 characters.').max(2000),
})

export const profileSchema = z.strictObject({
  displayName,
  bio: z.string().trim().max(1000, 'Bio is too long.'),
  city: z.string().trim().max(60, 'City is too long.'),
})

// ---- Payments ----------------------------------------------------------------
export const paymentIdSchema = z.strictObject({ paymentId: idSchema })
export const mockPaySchema = z.strictObject({ paymentId: idSchema, outcome: z.enum(['PAID', 'FAILED']) })

// The provider's callback body. Parsed only AFTER the signature checks out.
export const callbackBodySchema = z.strictObject({
  paymentId: idSchema,
  amountFils: z.number().int().positive().max(100_000_000),
  currency: z.literal('KWD'),
  status: z.enum(['PAID', 'FAILED']),
  providerRef: z.string().regex(/^mock_[0-9a-f-]{36}$/),
})
export type CallbackBody = z.output<typeof callbackBodySchema>
