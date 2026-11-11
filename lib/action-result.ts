// What every Server Action returns to its form. Never a database row: anything
// returned here is serialized to the browser.
export type ActionState = { ok: boolean; error?: string; message?: string } | null

export const NOT_FOUND: ActionState = { ok: false, error: 'Not found.' }
export const NOT_ALLOWED: ActionState = { ok: false, error: 'Not allowed. Please sign in again and retry.' }
export const TOO_MANY: ActionState = { ok: false, error: 'Too many attempts. Please wait a few minutes.' }

export function fail(error: string): ActionState {
  return { ok: false, error }
}

export function done(message: string): ActionState {
  return { ok: true, message }
}

// Prisma's "unique constraint failed" error code.
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002'
}
