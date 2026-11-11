import { PrismaClient } from '@prisma/client'

// Tables whose rows may only ever be inserted. This is the second of three layers
// (no code path updates them; this extension throws; SQLite triggers abort).
const APPEND_ONLY = new Set(['BidRevision', 'Review', 'Message', 'AuditLog'])
const WRITE_OPS = new Set(['update', 'updateMany', 'upsert', 'delete', 'deleteMany'])

function makeClient() {
  // passwordHash is omitted from every query unless lib/auth.ts asks for it explicitly.
  const base = new PrismaClient({ omit: { user: { passwordHash: true } } })
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (APPEND_ONLY.has(model) && WRITE_OPS.has(operation)) {
            throw new Error(`${model} is append-only; ${operation} is not allowed`)
          }
          return query(args)
        },
      },
    },
  })
}

type Db = ReturnType<typeof makeClient>
export type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0]

// One client per process; in dev, Next.js hot-reloads modules, so keep it on globalThis.
const globalForDb = globalThis as unknown as { db?: Db }
export const db: Db = globalForDb.db ?? makeClient()
if (process.env.NODE_ENV !== 'production') globalForDb.db = db
