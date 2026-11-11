# DESIGN.md: Tailor Marketplace (made-to-order tailoring, student build)

## 1. Overview

A made-to-order tailoring marketplace with one login and two roles.
- A **CUSTOMER** posts a Request. Tailors bid on it, blind.
- The customer accepts one bid and pays the upfront part through a mocked hosted checkout.
- The **verified** provider callback creates the Order.
- Customer and tailor chat on the order. The tailor moves the order to IN_PROGRESS and then READY, with finished photos.
- The customer pays the on-completion part through the same verified flow, which sets the order to COMPLETED. The customer then leaves exactly one immutable review, which feeds the tailor's public profile.

The source code will be audited against the OWASP Top 10, so **every rule is enforced on the server**: in the Prisma `WHERE` clause of the query that reads or writes the row, in compare-and-set state transitions, and again in SQLite triggers as a backstop. The UI only reflects these rules.

### 1.1 Stack and pinned versions (as built)

| Package | Version | Note |
|---|---|---|
| next | **16.4.6** (exact) | The design workflow first proposed pinning Next 14.2.35. `npm audit` showed the 14.x line carries 25 unpatched advisories, including unauthenticated RCE on Windows-hosted servers (GHSA-p293-qw3h-jr36). 16.4.6 is the patched line, so the build uses it. |
| react / react-dom | **19.2.9** | Required by Next 16. Forms use `useActionState`. |
| @prisma/client / prisma | **5.22.0** | SQLite. `previewFeatures = ["omitApi"]` (passwordHash omitted globally). |
| zod | **4.6.7** | zod < 4.6.6 has a memory-exhaustion advisory. Uses `z.strictObject`. |
| server-only | 0.0.1 | Pure JS. |
| dev | typescript 5.6.3, @types/node 20, @types/react 19, tsx 4.23.15 (seed runner) | tsx ≥ 4.23 pulls esbuild 0.28, which fixes the dev-server advisory in older esbuild. |

`npm audit` reports **0 vulnerabilities** for this set. Next 16 specifics that the code follows
(from `node_modules/next/dist/docs`): `params`, `cookies()` and `headers()` are async; the old
`middleware.ts` is now `proxy.ts` (not used here: no edge/proxy authorization); Server Actions reject
a mismatched `Origin` but let a request with no `Origin` through, so `lib/csrf.ts` adds its own check.

### 1.2 Windows: `npm install`, `npm run setup`, `npm run dev`

```json
"scripts": {
  "setup": "node scripts/ensure-env.mjs && prisma migrate reset --force",
  "predev": "node scripts/ensure-env.mjs && prisma migrate deploy && prisma db execute --file prisma/sql/triggers.sql --schema prisma/schema.prisma",
  "dev": "next dev -p 3000",
  "typecheck": "tsc --noEmit",
  "db:reset": "prisma migrate reset --force",
  "audit:deps": "npm audit --omit=dev"
}
```

`setup` (and `db:reset`) drops the database, applies the committed migration (which includes the
triggers) and runs `prisma/seed.ts` through tsx.

- **`scripts/ensure-env.mjs`** uses only `node:fs`, `node:path` and `node:crypto`. It is idempotent.
  - It creates `.env` if missing, and fixes placeholder values such as `replace-me`, with:
    - `DATABASE_URL="file:./dev.db"`
    - `PAYMENT_WEBHOOK_SECRET=<64 hex chars = 32 random bytes>`
    - `APP_ORIGIN="http://localhost:3000"`
    - `MOCK_PAYMENTS="true"`
    - `TRUST_PROXY="false"`
  - It creates `uploads/`.
  - It renames the legacy `APP_URL` to `APP_ORIGIN`.
- **Migrations are committed.** Run `prisma/migrations/0001_init/migration.sql` and `migration_lock.toml` once, generated non-interactively with `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`. Startup always uses `prisma migrate deploy`, which is non-interactive and never prompts for a reset. `prisma migrate dev` is never run from a script.
- **Triggers** live in `prisma/sql/triggers.sql`, written as `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`. They are re-applied on every start, because Prisma's SQLite table rebuilds silently drop triggers. They were verified against Prisma 5.22 and SQLite.
- **No cmd-incompatible syntax:** no `VAR=x cmd`, `rm -rf`, `cp` or single quotes. Nothing spawns `.cmd` files from Node.
- **README notes:**
  - The first install downloads the Prisma engine DLL.
  - Stop `next dev` before running `npm install` or `prisma generate`, because Windows locks the DLL (EPERM).
  - Do not keep the project in a OneDrive- or Dropbox-synced folder.
  - Do not keep `dev.db` open in another tool.
  - Node 20 or 22 LTS is recommended (`.nvmrc` = 22). Node 24 also works.
- **`.gitignore`:** `.env`, `prisma/*.db*`, `prisma/demo-credentials.txt`, `uploads/`, `.next/`, `node_modules/`.

### 1.3 How the three source designs were merged (conflicts resolved)

| Topic | Options in the sources | Decision | Why |
|---|---|---|---|
| Middleware | none (pragmatic, simple) vs nonce/header middleware (security-first) | **No `middleware.ts`.** Static security headers come from `next.config.mjs`. | Edge middleware cannot query SQLite, so it can never be an authz boundary. Leaving it out removes the CVE-2025-29927 class of bugs and keeps every check visible. |
| CSP | nonce + strict-dynamic vs `'unsafe-inline'` | Static CSP: `script-src 'self' 'unsafe-inline'` (+ `'unsafe-eval'` in dev only). | A nonce CSP in Next 14 needs middleware. React escaping plus a ban on `dangerouslySetInnerHTML` is the primary XSS control. |
| Mock provider transport | HTTP self-call to `/api/payments/callback` vs in-process call | **In-process call to the exact same function** (`receiveProviderCallback(rawBody, headers)`) that the public route handler uses. The mock serializes the body, signs it and passes the raw string plus the signature header, so verification is genuine. | No outbound fetch, no SSRF surface, and no Windows localhost IPv4/IPv6 mismatch. The public route stays the real network boundary and can be tested with curl. |
| Signature scheme | HMAC over `id:amount:status` vs over a timestamp, eventId and fields | HMAC-SHA256 over `v1.<t>.<rawBody>`, header `X-Mock-Signature: t=<unix>,v1=<hex>`, 300 s window. The body holds `paymentId`, `amountFils`, `currency`, `status` and `providerRef`. | Covers payment id and amount as the spec requires, plus status (a FAILED event cannot be relabelled PAID) and freshness. The raw body is verified before `JSON.parse`. |
| Idempotency | CAS only vs a PaymentEvent inbox | **CAS `PENDING -> PAID`** as the first write, plus `Payment.providerRef @unique`, `Order.requestId`/`bidId`/`upfrontPaymentId @unique` and an INSERT trigger. No inbox table. | Three independent guards without an extra model to explain. |
| Bid revised during checkout | freeze the bid while a payment is active vs cancel the pending checkout | **Revise cancels the PENDING checkout(s) of that bid**, and settlement re-checks `bidVersion`; a stale capture becomes `REFUND_DUE`. | A customer cannot lock a tailor out by opening a checkout, and a stale price can never create an order. |
| Rate limiting | in-memory vs DB table | **`RateLimit` table** (DB). | Survives HMR and dev restarts, and is auditable. |
| Login lockout | `User.failedLogins` vs a keyed limiter | `RateLimit` keyed by `sha256(email)`, which also covers emails that do not exist, plus a per-IP key. | A lockout never confirms that an account exists. |
| Session expiry | absolute only vs absolute + idle | **7 days absolute + 24 h idle.** `lastSeenAt` is refreshed at most every 5 minutes, with a DB write (no cookie write). | Stronger; works within Next 14's rule that server components cannot set cookies. |
| scrypt parameters | N=2^17 p=1 (256 MiB maxmem) vs N=2^15 r=8 p=3 (64 MiB) | **N=2^15, r=8, p=3, keylen 64, maxmem 64 MiB.** Parameters are stored in the hash, and the hash is upgraded on login when they change. | An OWASP-listed equivalent set that uses 32 MiB per hash, which is safe for concurrent logins on a student laptop. The scaffold's current N=2^14 is upgraded. |
| Blind stats threshold | >= 3 bids vs >= 2 competitors | Aggregate only **other** tailors' active bids. Show lowest and fastest only when **competitorCount >= 2** and the request is OPEN. | With a single competitor the minimum would be that tailor's own number. |
| Customer identity for tailors | displayName vs hidden | **Hidden until an order exists.** | Least data, and it discourages taking deals off-platform. |
| Uploads | JPEG/PNG/WebP vs JPEG/PNG with metadata strip | **JPEG + PNG only**, magic bytes, 5 MiB, dimensions <= 6000 px, and EXIF/GPS metadata stripped in pure TypeScript. | Privacy control with no native `sharp`, so the Windows install stays reliable. |
| Upload model | `Upload` vs `Photo` | `Upload` (metadata) + `Request.referencePhotoId` + `OrderPhoto` (finished photos, `inPortfolio`). | Matches the required entity list and keeps files authorized through one route. |
| Append-only enforcement | code only vs triggers vs a Prisma extension | **All three:** no update/delete code path, a query extension in `lib/db.ts` that throws, and SQLite triggers. | Defense in depth. Triggers are re-applied on every start. |
| `?next=` after login | safeNext vs none | **None.** The landing page is always chosen by role on the server. | Removes the open-redirect class. |
| Seed | `tsx prisma/seed.ts` vs plain `.mjs` | **`prisma/seed.mjs`**, run by hand only. It imports `lib/scrypt-core.mjs` and refuses to run in production. Random demo passwords go to the gitignored `prisma/demo-credentials.txt`. | No esbuild native binary and no default credentials. |

### 1.4 Where the current build differs from this design

The rest of this document is the synthesized design. These points are what the code actually does:

- **Versions:** Next 16 / React 19 / zod 4 instead of Next 14 / React 18 / zod 3 (see 1.1). Sync-API notes for Next 14 elsewhere in this file do not apply.
- **Seed:** `prisma/seed.ts` run by `tsx` (patched 4.23.15), importing `lib/password.ts`. There is no `scrypt-core.mjs`. It still refuses to run in production and writes random passwords to the gitignored credentials file.
- **Triggers:** in the init migration, and re-applied idempotently by `predev` from `prisma/sql/triggers.sql` (25 triggers).
- **Callback header:** `x-provider-signature: t=<unix>,v1=<hex>`.
- **CSP:** `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'` for pages, with **no `script-src`** yet (left to Next's defaults); `default-src 'none'; sandbox` for `/api/files/*`. A nonce-based `script-src` is an open item (see 13.4).
- **Not built yet:** the `/account/password` page, the ESLint import-boundary config, and the vitest suite. Their checks are covered for now by `npm run test:security` (`scripts/security-selftest.ts` + `scripts/check-triggers.mjs`) and the manual checks listed in the README.
- **Changed after the independent review** (details in the README):
  - Blind-bid figures are **ranges** (about 10% wide, at least 5 KWD; turnaround in bands), not exact minimums, because a sock-puppet tailor account can always reach the threshold.
  - `MOCK_PAYMENTS` defaults to `false`, and boot fails if it is `true` in production.
  - Rate limits use an atomic increment and count each attempt before the password check.
  - Password hashing is capped at 4 concurrent operations, with a bounded queue.
  - `clientIp()` uses the right-most `X-Forwarded-For` hop.
  - Signup is limited per email.
  - The callback body is capped while streaming.
  - Image cleaning uses allowlists and walks every JPEG scan.
  - `statusBefore` is read inside the transaction.

---

## 2. Data model

The complete schema is in `prisma/schema.prisma`. Conventions:
- Enum-like columns are `String`. Their allowed values are defined once in `lib/enums.ts` and enforced with zod `z.enum`, and the critical ones also by triggers.
- Money is always `Int` fils (1 KWD = 1000 fils).
- `lib/money.ts` parses KWD strings with `/^\d{1,5}(\.\d{1,3})?$/` using string math, never floats.

| Entity | Key fields | Relations | Invariants |
|---|---|---|---|
| **User** | `email @unique` (lowercased), `passwordHash` (globally omitted), `role` CUSTOMER\|TAILOR, `displayName`, `passwordChangedAt` | sessions, tailorProfile?, requests, bids, customerOrders, tailorOrders, payments, messages, reviews given and received, uploads, auditLogs | The role is set only at signup and is immutable (triggers `user_role_valid`, `user_role_immutable`). No ADMIN role exists. Email is never shown to another user. |
| **Session** | `id` = sha256(token) hex, `userId`, `createdAt`, `lastSeenAt`, `expiresAt` | user (cascade) | The raw token is never stored. Rows are deleted on logout, on password change (all of the user's rows), and when found expired. |
| **TailorProfile** | `userId @id`, `bio` <= 1000, `city` <= 60 | user | Created in the same transaction as a TAILOR user. Stats are computed on read and never stored. |
| **Request** | `customerId`, `title`, `pieceType`, `description`, `budgetMinFils?`/`budgetMaxFils?`, `neededBy?`, `referencePhotoId? @unique`, `status` OPEN\|AWARDED\|CANCELLED, `awardedAt`, `cancelledAt` | customer, referencePhoto (Upload), bids, order?, payments | `customerId` comes from the session. Only settlement sets AWARDED. Only the owner sets CANCELLED, and only from OPEN. |
| **Bid** | `requestId`, `tailorId`, `upfrontFils`, `completionFils`, `totalFils`, `turnaroundDays`, `note?`, `status` PENDING\|DECLINED\|ACCEPTED\|LOST, `version` | request, tailor, revisions, payments, order? | `@@unique([requestId, tailorId])`: one bid per tailor per request. `totalFils = upfront + completion`, each amount >= 1000 (trigger). Amounts can change only while the request is OPEN (trigger). `version` equals the latest `revisionNo`. |
| **BidRevision** | `bidId`, `revisionNo`, the amounts, `totalFils`, `turnaroundDays`, `note`, `statusBefore` NEW\|PENDING\|DECLINED | bid | `@@unique([bidId, revisionNo])`. Append-only (code, query extension, triggers). |
| **Payment** | `kind` UPFRONT\|COMPLETION, `status` PENDING\|PAID\|FAILED\|CANCELLED\|REFUND_DUE, `amountFils`, `currency`, `customerId`, `requestId`, `bidId`, `bidVersion`, `orderId?`, `providerRef? @unique`, `expiresAt`, `paidAt?` | customer, request, bid, order? ("OrderPayments"), upfrontFor?, completionFor? | `amountFils` is copied from the Bid or Order row on the server. Status leaves PENDING only through a compare-and-set. PAID is set only by verified settlement. |
| **Order** (`@@map("orders")`) | `requestId @unique`, `bidId @unique`, `customerId`, `tailorId`, `upfrontPaymentId @unique`, `completionPaymentId? @unique`, snapshots (`upfrontFils`, `completionFils`, `totalFils`, `turnaroundDays`), `status` ACCEPTED\|IN_PROGRESS\|READY\|COMPLETED, timestamps | request, bid, customer, tailor, upfrontPayment, completionPayment?, payments, messages, photos, review? | Created only in `lib/payments/settle.ts`. The INSERT trigger `orders_require_paid_upfront` needs a PAID UPFRONT payment for the same bid, request, customer and amount. `orders_status_guard` allows forward transitions only. `orders_complete_requires_paid` needs a matching PAID COMPLETION payment. `orders_snapshot_immutable` blocks changes to the snapshot columns. |
| **OrderPhoto** | `orderId`, `uploadId @unique`, `inPortfolio` | order, upload | At most 6 per order. Added by the order's tailor while IN_PROGRESS or READY. Public only when the order is COMPLETED and `inPortfolio` is set. |
| **Message** | `id Int autoincrement` (cursor), `orderId`, `senderId`, `body` 1..2000 | order, sender | Exists only on an Order. Immutable (triggers). `senderId` comes from the session. |
| **Review** | `orderId @unique`, `customerId`, `tailorId`, `rating` 1..5, `text` 10..2000 | order, customer, tailor | One per order. The order must be COMPLETED and the rating 1..5 (trigger `review_rating_range`). Immutable. |
| **Upload** | `ownerId`, `kind` REQUEST_REFERENCE\|ORDER_FINISHED, `storedName @unique` (uuid.ext), `mimeType`, `sizeBytes`, `width`, `height`, `sha256` | owner, request?, orderPhoto? | Bytes live in `uploads/`, outside `public/`, and are served only by `/api/files/[id]`. |
| **RateLimit** | `key @id`, `count`, `windowStart`, `blockedUntil?` | – | Fixed window, written with an upsert in a transaction. |
| **AuditLog** | `action`, `userId?`, `entity`, `entityId`, `ip`, `detail` | user? | Append-only (triggers). Never holds secrets, tokens, cookies, signatures or message bodies. |

`lib/db.ts` provides:
- `new PrismaClient({ omit: { user: { passwordHash: true } } })`, so `passwordHash` is returned only where `lib/auth.ts` explicitly asks for it with `omit: { passwordHash: false }`;
- a `$extends({ query })` that throws on `update`, `updateMany`, `upsert`, `delete` and `deleteMany` for `bidRevision`, `review`, `message` and `auditLog`;
- caching the client on `globalThis` in dev.

---

## 3. Route and page table

The first statement of every page and route handler is the guard shown. Every server action is listed separately because **each one is an independently callable POST endpoint**.

| Path | Method | Role | Server-side rule |
|---|---|---|---|
| `/` | GET page | PUBLIC | If signed in, `redirect(roleHome(user.role))` using the role from the DB. Otherwise, the landing page. |
| `/login` | GET page | ANONYMOUS | Signed in: redirect to roleHome. |
| `loginAction` | POST action | ANONYMOUS | Origin check, rate limits run before scrypt, dummy-hash timing, generic error, anti-fixation, then `redirect(roleHome)`. |
| `/signup` | GET page | ANONYMOUS | Signed in: redirect to roleHome. |
| `signupAction` | POST action | ANONYMOUS | Origin check, rate limit, zod `.strict()` with `role: z.enum(['CUSTOMER','TAILOR'])`. User and TailorProfile are created in one transaction. P2002 gives a generic message. Then a new session and roleHome. |
| `logoutAction` | POST action | AUTHENTICATED | Deletes the `Session` where id = sha256(cookie) and clears the cookie. |
| `/account/password` + `changePasswordAction` | GET / POST | AUTHENTICATED | Verify the current password, rate limit, new hash, delete **all** of the user's sessions, create a new one. |
| `/customer/requests` | GET page | CUSTOMER | `request.findMany({ where: { customerId: me } })`. |
| `/customer/requests/new` + `createRequest` | GET / POST multipart | CUSTOMER | zod strict. `customerId = me`, `status = 'OPEN'`. The optional photo goes through `saveImage`. Request and Upload are created in one transaction. |
| `/customer/requests/[id]` | GET page | CUSTOMER (owner) | `bids.getRequestForCustomer(id, me)` with `where { id, customerId: me }`, else `notFound()`. Returns all bids with tailor name, profile link and full revision history. |
| `cancelRequest` | POST action | CUSTOMER (owner) | Transaction: `updateMany({ id, customerId: me, status: 'OPEN' } -> CANCELLED)` must affect 1 row. Bids PENDING/DECLINED become LOST and PENDING payments become CANCELLED. |
| `declineBid` | POST action | CUSTOMER (owner) | `bid.updateMany({ id, status: 'PENDING', request: { customerId: me, status: 'OPEN' } } -> DECLINED)` must affect 1 row. The bid's PENDING payments become CANCELLED. |
| `startUpfrontPayment` | POST action | CUSTOMER (owner) | The form carries only `bidId`. Guarded bid lookup. `amountFils = bid.upfrontFils` from the DB. Creates (or reuses) a PENDING payment, then redirects to the checkout. Creates no order. |
| `/customer/orders` | GET page | CUSTOMER | `order.findMany({ where: { customerId: me } })`. |
| `/tailor/requests` | GET page | TAILOR | `bids.listOpenRequestsForTailor(me)`: open requests plus a `_count`, with bids filtered to `tailorId: me`. No customer identity. |
| `/tailor/requests/[id]` | GET page | TAILOR | `bids.getRequestForTailor(id, me)`: the public request fields, the tailor's own bid and revisions, and an aggregate-only competition DTO. |
| `placeBid` | POST action | TAILOR | Rate limit, request OPEN, zod strict, `tailorId = me`. Creates Bid v1 and BidRevision #1 in one transaction. P2002 returns "revise instead". |
| `reviseBid` | POST action | TAILOR (bid owner) | CAS on `{ id, tailorId: me, version, status in [PENDING, DECLINED] }` with the request OPEN, then status PENDING and version+1. Appends a revision and cancels the bid's PENDING payments. |
| `/tailor/bids` | GET page | TAILOR | `bid.findMany({ where: { tailorId: me } })` with the request title and status only. |
| `/tailor/orders` | GET page | TAILOR | `order.findMany({ where: { tailorId: me } })`. |
| `/tailor/profile` + `updateProfile` | GET / POST | TAILOR | zod strict `{ displayName, bio, city }`. Updates only where `userId: me`. |
| `/orders/[id]` | GET page | CUSTOMER or TAILOR (participant) | `authz.getOrderForParticipant(id, me)`, else `notFound()`. Buttons are UX only. |
| `startWork` | POST action | TAILOR (order's tailor) | `orders.transition('START_WORK')`: CAS `{ id, tailorId: me, status: 'ACCEPTED' }`. |
| `markReady` | POST action | TAILOR (order's tailor) | CAS `{ id, tailorId: me, status: 'IN_PROGRESS' }`. |
| `addFinishedPhoto` | POST multipart | TAILOR (order's tailor) | Order `{ id, tailorId: me, status in [IN_PROGRESS, READY] }`, fewer than 6 photos, `saveImage`, then OrderPhoto. |
| `startCompletionPayment` | POST action | CUSTOMER (order's customer) | Order `{ id, customerId: me, status: 'READY', completionPaymentId: null }`. `amountFils = order.completionFils`. PENDING payment, then checkout. |
| `sendMessage` | POST action | participant | Gate, rate limit 20 per minute per user per order, zod body 1..2000, `senderId = me`. |
| `submitReview` | POST action | CUSTOMER (order's customer) | Order `{ id, customerId: me, status: 'COMPLETED' }`. `tailorId` is copied from the order. P2002 returns "already reviewed". |
| `/mock-provider/checkout/[paymentId]` | GET page | CUSTOMER (payer) | `MOCK_PAYMENTS==='true'`, else 404. Payment `{ id, customerId: me, status: 'PENDING', expiresAt > now }`, else 404. Shows the amount from the DB. |
| `mockProviderSubmit` | POST action | CUSTOMER (payer) | Same gate and checks. Builds and signs the event and calls `receiveProviderCallback()`, then redirects to `/payments/[id]`. Never writes Payment or Order itself. |
| `/payments/[id]` | GET page | CUSTOMER (payer) | `payment.findFirst({ id, customerId: me })`. Read-only. Ignores query flags. Links to the order once one exists. |
| `/api/payments/callback` | POST route | NONE (HMAC) | Ignores cookies. Size, content type, timestamp, HMAC (timingSafeEqual), zod strict, amount equals the DB value, then `settleVerifiedPayment()`. |
| `/api/orders/[id]/messages?after=` | GET route | participant | 401 when there is no session, 404 for a non-participant. Returns up to 100 messages after the cursor. `no-store`. |
| `/api/files/[id]` | GET route | per upload | `authz.canViewUpload()`, else 404. Safe headers. |
| `/tailors/[id]` | GET page | PUBLIC | `user.findFirst({ id, role: 'TAILOR' })`. Public selects only, with aggregates computed. |

`roleHome`: CUSTOMER goes to `/customer/requests`, TAILOR to `/tailor/requests`. A page opened by the wrong role redirects to that user's roleHome and renders no data. An action called by the wrong role returns a generic "Not found" and audits `AUTHZ_DENIED`.

---

## 4. Authentication and sessions (`lib/auth.ts`, `lib/password.ts`, `lib/scrypt-core.mjs`)

**Passwords**
- Hash with `crypto.scrypt(password.normalize('NFKC'), salt16, 64, { N: 32768, r: 8, p: 3, maxmem: 64 MiB })`. It is async and runs on the libuv threadpool.
- Stored as `scrypt$32768$8$3$<saltB64url>$<hashB64url>`.
- Verification recomputes with the **stored** parameters and compares with `timingSafeEqual`. `needsRehash()` upgrades the hash on login when the parameters change.
- Policy (zod):
  - 12 to 128 characters after NFKC;
  - not in the bundled common-password list (`lib/common-passwords.ts`, about 10k entries);
  - must not contain the email local part;
  - no composition rules.
- `lib/scrypt-core.mjs` holds the pure functions, so the plain-Node `prisma/seed.mjs` can share them.

**Signup** (`signupAction`)
1. `assertSameOrigin()`.
2. `rateLimit('signup:ip:<ip>', 5, 1h)`.
3. zod `.strict()` `{ email, password, displayName, role: z.enum(['CUSTOMER','TAILOR']) }`. This is the only place a client-chosen role is accepted.
4. Hash first, then `$transaction`: create the User, plus a TailorProfile when role is TAILOR.
5. P2002 returns "Could not create the account. If you already registered, sign in."
6. `createSession()`, audit SIGNUP, then `redirect(roleHome)`.

**Login** (`loginAction`)
1. Origin check and zod.
2. Before any scrypt, check `rateLimit('login:acct:<sha256(email)>')` (5 failures per 15 min, then blocked 15 min; applies to unknown emails too) and `rateLimit('login:ip:<ip>', 50, 15min)`.
3. `user.findUnique({ where: { email }, omit: { passwordHash: false } })`. If there is no user, verify against a precomputed dummy hash of the same cost.
4. Any failure: increment the counter, audit `LOGIN_FAILED`, and return **"Invalid email or password"**.
5. Success:
   - reset the account counter;
   - delete the Session matching any presented cookie (anti-fixation);
   - delete the user's expired sessions;
   - rehash if needed;
   - `createSession()`, audit `LOGIN_SUCCESS`, `redirect(roleHome(user.role))`.

There is no `next` parameter.

**Session token and cookie**
- `token = randomBytes(32).toString('base64url')` (256 bits). The DB stores `Session.id = sha256(token)` in hex.
- Cookie: `tm_session` on http, `__Host-tm_session` when `APP_ORIGIN` is https. Attributes: `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`, `Secure` in production, no Domain.
- Cookies are set only in server actions (Next 14 rule).

**`getCurrentUser()`** is wrapped in React `cache()` (once per request).
1. Read the cookie. Reject values that are not `^[A-Za-z0-9_-]{43}$`.
2. `session.findUnique({ where: { id: sha256 }, select: { expiresAt, lastSeenAt, user: { select: { id, role, displayName } } } })`.
3. If `expiresAt <= now` or `lastSeenAt < now - 24h`: delete the row and return null.
4. If `lastSeenAt` is more than 5 min old: update it.
5. Any thrown error returns **null (fail closed)**.

**Guards**
- `requireUser()` (pages): redirect to `/login` when there is no user.
- `requireRole(role)` (pages): `requireUser`, then redirect to roleHome on a role mismatch.
- `requireActionUser(role?)` (every server action):
  - `assertSameOrigin()`: `Origin`, when present, must equal `APP_ORIGIN`, and `Sec-Fetch-Site` must not be `cross-site`;
  - then the session and role checks, returning `{ ok: false }` on failure.
- Route handlers call `getCurrentUser()` and answer 401 or 404 JSON.

**Logout and password change.** Logout is POST only and deletes the row. A password change deletes all of the user's sessions and issues a fresh one.

---

## 5. Authorization rules (role + ownership, and where each check lives)

1. **Role.** Always read from the Session-to-User join in the DB, on every request. Never from a cookie value, hidden field or URL. It is immutable after signup (zod + triggers).
2. **Every entry point checks for itself.**
   - Each `page.tsx`, each exported server action and each route handler calls its guard first.
   - Layouts are never used as gates: they do not re-run on client navigation and do not protect actions.
   - `'use server'` files export **only** guarded actions, because every export becomes a public endpoint. Helpers live in plain `server-only` modules.
3. **Ownership in the WHERE clause.** The owner predicate goes into the same Prisma query that reads or writes the row, for example:
   - `findFirst({ where: { id, customerId: me } })`
   - `updateMany({ where: { id, tailorId: me, status: from } })`
   - `orderPartyWhere(me, id) = { id, OR: [{ customerId: me }, { tailorId: me }] }`

   There is never a `findUnique(id)` followed by a separate `if`. A miss gives `notFound()` or a 404, so another user's id looks exactly like one that does not exist.
4. **Shared helpers** in `lib/authz.ts`: `getOwnedRequest`, `getOrderForParticipant`, `canViewUpload`, `orderPartyWhere`.
5. **Mutations** are compare-and-set `updateMany` calls with the from-state in the WHERE clause, and must affect `count === 1`.
6. **Mass assignment.** All zod object schemas are `.strict()`. Prisma `data` objects are built field by field and never spread from form data. Owner ids, status, amounts, totals and the review's tailorId always come from the session or from DB rows.
7. **Database backstop.** Triggers re-check money and state invariants inside the writing statement.
8. **Import boundaries (ESLint).**
   - `no-restricted-imports`: `@/lib/db` may be imported only from `lib/**`, and `lib/payments/settle` only from `lib/payments/callback.ts`.
   - `no-restricted-properties`: bans `$queryRawUnsafe` and `$executeRawUnsafe`.
   - `react/no-danger` is an error.

---

## 6. Payment to order flow

Files:
- `lib/payments/checkout.ts`: create and cancel payments;
- `lib/payments/signature.ts`: sign and verify;
- `lib/payments/callback.ts`: `receiveProviderCallback`;
- `lib/payments/settle.ts`: `settleVerifiedPayment`;
- `lib/mock-provider.ts`: the simulated provider.

Only `signature.ts` reads `PAYMENT_WEBHOOK_SECRET`. `lib/env.ts` validates it at boot (64 hex chars, not a placeholder) and the app refuses to start otherwise. It is never `NEXT_PUBLIC_`.

**Step 1. The click creates only a PENDING payment** (`startUpfrontPayment(bidId)`).
1. `requireActionUser('CUSTOMER')` and `rateLimit('pay:init:<me>', 10, 10min)`. zod `.strict()` `{ bidId }`; there is no amount field.
2. `$transaction`:
   - `bid = tx.bid.findFirst({ where: { id: bidId, status: 'PENDING', request: { customerId: me, status: 'OPEN' } } })`, else "Not found".
   - Reuse an existing PENDING, unexpired payment with the same `bidId` and `bidVersion`, so a double-click does not create two checkouts.
   - Otherwise `tx.payment.updateMany({ where: { requestId, status: 'PENDING' }, data: { status: 'CANCELLED' } })`, then `tx.payment.create({ kind: 'UPFRONT', amountFils: bid.upfrontFils, bidId, bidVersion: bid.version, requestId, customerId: me, expiresAt: now + 30 min })`.
3. Audit `PAYMENT_CREATED`, then `redirect('/mock-provider/checkout/' + id)`. Bid, Request and Order are untouched.

`startCompletionPayment(orderId)` works the same way:
- guard `{ id, customerId: me, status: 'READY', completionPaymentId: null }`;
- `amountFils = order.completionFils`, `orderId` set, `bidVersion = order bid's version`;
- cancels the other PENDING COMPLETION payments for the order.

**Step 2. Hosted checkout (mock).** `/mock-provider/checkout/[paymentId]` returns 404 unless:
- `MOCK_PAYMENTS === 'true'`;
- the payer is the session user;
- the payment is PENDING;
- it has not expired.

The page shows the server amount, a "MOCK PROVIDER, no real money" banner and **no card fields**.

**Step 3. Provider decision** (`mockProviderSubmit(paymentId, outcome: 'PAID'|'FAILED')`).
1. Same gate and checks.
2. `providerRef = 'mock_' + randomUUID()`.
3. `rawBody = JSON.stringify({ paymentId, amountFils: payment.amountFils, currency: 'KWD', status: outcome, providerRef })`.
4. `t = unix seconds`, `v1 = HMAC-SHA256(secret, 'v1.' + t + '.' + rawBody)`.
5. Call **`receiveProviderCallback(rawBody, { contentType: 'application/json', signature: 't=..,v1=..' })`**, the same function the public route uses.
6. `redirect('/payments/' + id)`.

The secret and the signature never reach the browser.

**Step 4. Verification** (`receiveProviderCallback`; the route handler `POST /api/payments/callback` reads `await req.text()` and delegates).
1. Ignore cookies and session.
2. Content-Type must be `application/json` and the body at most 2 KB. Otherwise 400.
3. Parse the header `t=<int>,v1=<64 hex>`. Require `|now - t| <= 300 s`, else 401.
4. Recompute the HMAC over `'v1.' + t + '.' + rawBody` and compare with `crypto.timingSafeEqual` on equal-length buffers. A mismatch returns **401**, audits `PAYMENT_BAD_SIGNATURE`, and touches nothing else in the DB.
5. `JSON.parse`, then zod `.strict()` `{ paymentId: cuid, amountFils: int > 0, currency: 'KWD', status: 'PAID'|'FAILED', providerRef: /^mock_[0-9a-f-]{36}$/ }`.
6. The result is the branded type `VerifiedProviderEvent`. Only this function can construct it, and `settleVerifiedPayment()` accepts nothing else.
7. Load the payment: missing gives 404. `amountFils !== payment.amountFils` or a currency mismatch gives **400** plus `PAYMENT_AMOUNT_MISMATCH`, with no state change.
8. FAILED: `updateMany({ id, status: 'PENDING' } -> FAILED)`, then 200.
9. PAID: `settleVerifiedPayment(evt)`. Answer 200 for applied, already processed or refund-due, and **500** only for transient errors (the transaction rolled back, so a retry is safe).

**Step 5. Settlement** (one `prisma.$transaction(async tx => …, { timeout: 10000 })`; only `tx` is used inside, never `db`).
1. **Claim**, which is the first write and takes SQLite's write lock: `tx.payment.updateMany({ where: { id, status: 'PENDING', amountFils: evt.amountFils }, data: { status: 'PAID', paidAt: now, providerRef } })`.
2. If `count === 0`, reload:
   - PAID or REFUND_DUE: `already_processed` (idempotent no-op, 200).
   - CANCELLED or FAILED (superseded but captured): set `REFUND_DUE` with a status-conditional update, audit `PAYMENT_REFUND_DUE`, return.
3. **UPFRONT.** Load the bid and request in `tx`. Guard:
   - `bid.status === 'PENDING'`
   - `bid.version === payment.bidVersion`
   - `bid.upfrontFils === payment.amountFils`
   - `request.status === 'OPEN'`
   - `request.customerId === payment.customerId`

   If any check fails, set REFUND_DUE and create no order. Otherwise, in order:
   - `tx.request.updateMany({ id, status: 'OPEN' } -> AWARDED, awardedAt)`, count 1;
   - `tx.bid.updateMany({ id, status: 'PENDING', version } -> ACCEPTED)`, count 1;
   - other bids `{ requestId, id: { not }, status in [PENDING, DECLINED] } -> LOST`;
   - `tx.order.create({ requestId, bidId, customerId, tailorId: bid.tailorId, upfrontPaymentId: payment.id, snapshots from the bid, status: 'ACCEPTED' })` (the trigger re-checks it);
   - `tx.payment.update({ id }, { orderId })`;
   - other PENDING payments of the request become CANCELLED.
4. **COMPLETION.** `tx.order.updateMany({ where: { id: payment.orderId, customerId: payment.customerId, status: 'READY', completionPaymentId: null, completionFils: payment.amountFils }, data: { status: 'COMPLETED', completedAt, completionPaymentId: payment.id } })` must return count 1 (the trigger re-checks it). Otherwise REFUND_DUE. Then the other PENDING COMPLETION payments become CANCELLED.
5. Any throw (SQLITE_BUSY, P2002 or a trigger ABORT) rolls back everything, including the claim. Audit entries (`PAYMENT_PAID`, `ORDER_CREATED`, `ORDER_TRANSITION`) are written after the commit.

**Step 6. Return page.** `/payments/[id]` is read-only. It shows the DB status ("still processing, refresh" while PENDING) and a link to the order. Reaching that URL proves nothing.

**Invariants**
- An Order exists if and only if a PAID UPFRONT payment for its bid exists. They are written in one transaction and checked by a trigger.
- `Order.requestId`, `bidId` and `upfrontPaymentId` are UNIQUE, and `Payment.providerRef` is UNIQUE.
- Amounts never come from the client.

---

## 7. Blind bidding enforcement (`lib/bids.ts`, `import 'server-only'`)

Tailor pages import only the `*ForTailor` functions, and customer pages only `*ForCustomer`. No other module calls `db.bid` for reads.

1. **`listOpenRequestsForTailor(me, cursor)`**
   - Query: `request.findMany({ where: { status: 'OPEN' }, take: 50, select: { id, title, pieceType, budgetMinFils, budgetMaxFils, neededBy, createdAt, referencePhotoId, _count: { select: { bids: true } }, bids: { where: { tailorId: me }, select: { id: true, status: true } } } })`.
   - The SQL filter means only the caller's own bid can come back. There is no `customer` in the select.
2. **`getRequestForTailor(requestId, me)`** runs three queries:
   - (a) `request.findFirst({ where: { id, OR: [{ status: 'OPEN' }, { bids: { some: { tailorId: me } } }] }, select: publicRequestFields })`. There is no bids, order, payments or customer relation in the select.
   - (b) `bid.findUnique({ where: { requestId_tailorId: { requestId, tailorId: me } }, select: { own values, status, version, revisions: { orderBy: { revisionNo: 'asc' } } } })`.
   - (c) `bid.aggregate({ where: { requestId, tailorId: { not: me }, status: { in: ['PENDING','DECLINED'] } }, _count: { _all: true }, _min: { totalFils: true, turnaroundDays: true } })`, which runs as `SELECT COUNT(*), MIN(totalFils), MIN(turnaroundDays)`. No other tailor's row, id, name, note or amount pair is ever loaded into Node.
3. **`toCompetitionView(agg, request.status)`** returns `{ competitorCount, lowestTotalFils, fastestTurnaroundDays }`.
   - Lowest and fastest are `null` unless `competitorCount >= BLIND_MIN_COMPETITORS (2)`.
   - Everything is `null` unless the request is OPEN.
   - After an award, a tailor sees only their own status: ACCEPTED, or LOST shown as "awarded to another tailor". The winner's identity and price are never shown.
4. **DTO boundary.** Functions return hand-built DTOs, never Prisma rows. Client components receive only DTOs, because every client prop is serialized into the RSC payload. Server actions return only `{ ok, error }`. Bid data is never wrapped in `unstable_cache` or a fetch cache, and authenticated pages are dynamic.
5. **The customer view**, `getRequestForCustomer(id, me)`, uses `where: { id, customerId: me }` behind `requireRole('CUSTOMER')`. It is the only query that returns every bid with the tailor's identity and full revision history.
6. **Tests** (`tests/blind-bidding.test.ts`): seed tailors A, B and C on one request. `JSON.stringify` A's DTOs and assert that they contain none of B's or C's ids, display names, notes or amounts. Assert that lowest and fastest are null when there is only one competitor. Manual check: search the `?_rsc` responses in the Network tab while logged in as A.

---

## 8. Bid revisions and declines

- **Place** (`placeBid`).
  - `requireActionUser('TAILOR')` and `rateLimit('bid:<me>', 20, 1h)`.
  - zod strict: upfront and completion as KWD strings converted to fils (1,000 to 10,000,000 each), turnaround 1..365, note <= 1000.
  - In one transaction:
    - `tx.request.updateMany({ id, status: 'OPEN' }, { updatedAt: now })` must return count 1. This is the first write, so it takes the lock and proves the request is OPEN.
    - `tx.bid.create({ tailorId: me, totalFils, version: 1, status: 'PENDING' })`.
    - `tx.bidRevision.create({ revisionNo: 1, statusBefore: 'NEW' })`.
  - P2002 on `(requestId, tailorId)` returns "You already bid; revise it instead."
- **Revise** (`reviseBid`).
  - The form carries `bidId` and `expectedVersion` with the new values. Values identical to the current ones are rejected (no revision spam).
  - In one transaction:
    - touch the request as above (must be OPEN);
    - `tx.bid.updateMany({ where: { id, tailorId: me, version: expectedVersion, status: { in: ['PENDING','DECLINED'] } }, data: { new values, totalFils, status: 'PENDING', declinedAt: null, version: expectedVersion + 1 } })` must return count 1, otherwise "This bid changed or can no longer be revised";
    - `tx.bidRevision.create({ revisionNo: expectedVersion + 1, statusBefore })`;
    - `tx.payment.updateMany({ where: { bidId, status: 'PENDING' }, data: { status: 'CANCELLED' } })`.
- **Decline** (`declineBid`): the customer, only while the bid is PENDING and the request OPEN. The bid's pending checkouts are cancelled.
- **Soft decline.** DECLINED is not terminal. A tailor revision returns the bid to PENDING with a new version, and the customer sees "revised after decline" through `statusBefore`. A DECLINED bid cannot be accepted until it is revised.
- **Terminal states.** ACCEPTED and LOST cannot be revised; the zod/CAS guard and the open-request trigger both block it.
- **History.** The customer sees the whole `BidRevision` history of every bid on their request. A tailor sees only their own.

---

## 9. Chat gating

- **Structural.** `Message.orderId` is required and no other conversation container exists, so chat cannot exist before the verified payment creates an Order. Request and bid pages say "Chat opens after the upfront payment is confirmed".
- **One gate.** `getOrderForParticipant(orderId, me)` = `order.findFirst({ where: orderPartyWhere(me, orderId), select: { id, customerId, tailorId, status } })`. These all use it:
  - the `/orders/[id]` page: the latest 50 messages rendered on the server, null giving `notFound()`;
  - `sendMessage`:
    - `requireActionUser()`;
    - zod `{ orderId: cuid, body: trim, 1..2000, control characters other than \n removed }`;
    - the gate;
    - `rateLimit('msg:<me>:<orderId>', 20, 1min)`;
    - `message.create({ data: { orderId: order.id, senderId: me, body } })`;
  - `GET /api/orders/[id]/messages?after=<int>`:
    - `getCurrentUser()`, else 401;
    - zod params;
    - the gate, else 404;
    - `message.findMany({ where: { orderId, id: { gt: after } }, orderBy: { id: 'asc' }, take: 100 })`, mapped to `{ id, body, createdAt, mine, senderName }`;
    - `Cache-Control: no-store`, `export const dynamic = 'force-dynamic'`, no CORS headers.
- **Live updates.** The `ChatBox` client component polls every 3 s, pauses while `document.hidden`, backs off to 15 s when idle, and polls immediately after a send. Polling was chosen over SSE because:
  - every poll re-runs the session and party checks, so logout, expiry or a password change cuts access within one interval;
  - SQLite has no change notifications;
  - it avoids long-lived connections under `next dev` on Windows.
- **Rendering.** Plain text, escaped by React, with `white-space: pre-wrap`. No HTML, no markdown, no auto-links.
- **Scope.** Both participants can read and post in every order status, including COMPLETED (after-care). Messages are immutable.

---

## 10. Order state machine (`lib/orders.ts`)

```ts
const TRANSITIONS = {
  START_WORK: { from: 'ACCEPTED',    to: 'IN_PROGRESS', actor: 'TAILOR',  stamp: 'startedAt' },
  MARK_READY: { from: 'IN_PROGRESS', to: 'READY',       actor: 'TAILOR',  stamp: 'readyAt' },
  // COMPLETE exists only in lib/payments/settle.ts (actor SYSTEM, verified COMPLETION payment)
} as const
```

`transition(event, orderId, me)` runs `db.order.updateMany({ where: { id, tailorId: me, status: t.from }, data: { status: t.to, [t.stamp]: now } })` and requires `count === 1`; otherwise it returns "Not allowed in the current state". There is no generic `setStatus`, and the target status is never read from the client.

| # | Transition | Actor | Trigger | Guard |
|---|---|---|---|---|
| T0 | (none) to ACCEPTED | SYSTEM | Verified UPFRONT PAID callback, through `settleVerifiedPayment` | CAS PENDING to PAID; bid PENDING with version = payment.bidVersion; upfrontFils = amount; request OPEN and owned by the payer; UNIQUE requestId, bidId and upfrontPaymentId; trigger `orders_require_paid_upfront` |
| T1 | ACCEPTED to IN_PROGRESS | TAILOR (order's) | `startWork` | `where { id, tailorId: me, status: 'ACCEPTED' }` count 1; trigger `orders_status_guard` |
| T2 | IN_PROGRESS to READY | TAILOR (order's) | `markReady` | `where { id, tailorId: me, status: 'IN_PROGRESS' }` count 1. Photos (`addFinishedPhoto`) are allowed in IN_PROGRESS and READY, max 6. |
| – | READY (checkout, not a state change) | CUSTOMER (order's) | `startCompletionPayment` | `where { id, customerId: me, status: 'READY', completionPaymentId: null }`; amount = `order.completionFils` |
| T3 | READY to COMPLETED | SYSTEM | Verified COMPLETION PAID callback | CAS PENDING to PAID; `updateMany { id: payment.orderId, customerId: payer, status: 'READY', completionPaymentId: null, completionFils: amount }` count 1; trigger `orders_complete_requires_paid` |
| – | after COMPLETED | CUSTOMER (order's) | `submitReview` | `where { id, customerId: me, status: 'COMPLETED' }`; `Review.orderId` UNIQUE; immutability and status triggers |

Rejected: any backward move or skip; a customer firing a tailor event; any client-driven COMPLETED; anything leaving COMPLETED. The trigger blocks these even if a code path is buggy.

**Related machines** (same compare-and-set pattern)

**Request**
- OPEN to AWARDED: settlement only.
- OPEN to CANCELLED: the owner. PENDING and DECLINED bids become LOST and PENDING payments become CANCELLED, in the same transaction.

**Bid**
- new to PENDING: the tailor.
- PENDING to DECLINED: the owner customer.
- PENDING or DECLINED to PENDING (version+1): the owning tailor's revision.
- PENDING to ACCEPTED: settlement.
- PENDING or DECLINED to LOST: award of another bid, or cancellation.

**Payment**
- PENDING to PAID or FAILED: verified callback only.
- PENDING to CANCELLED: superseded by a new checkout, revise, decline, cancel or another award.
- Late or stale capture to REFUND_DUE (terminal).
- An expired PENDING payment is refused at checkout.

---

## 11. Uploads (`lib/uploads.ts`, `lib/image-sanitize.ts`, `app/api/files/[id]/route.ts`)

**Accept**
- One reference photo per Request (`createRequest`).
- Finished photos per Order (`addFinishedPhoto`): at most 6, with an `inPortfolio` checkbox.

**Validation**
- Size 1 B to 5 MiB, checked in code. `experimental.serverActions.bodySizeLimit = '6mb'`.
- **Magic bytes** must be JPEG `FF D8 FF` or PNG `89 50 4E 47 0D 0A 1A 0A`. SVG, GIF, WebP, HTML and HEIC are rejected. The client MIME type and filename are ignored.
- Width and height are parsed from SOF0/SOF2 (JPEG) or IHDR (PNG) and must each be <= 6000.

**Sanitize** (pure TypeScript, no `sharp`)
- JPEG: drop APP1–APP15 and COM segments, which removes EXIF/GPS and XMP.
- PNG: drop the `tEXt`, `zTXt`, `iTXt`, `eXIf` and `tIME` chunks.
- Compute sha256.

**Store**
- `storedName = randomUUID() + '.jpg' | '.png'`.
- `path.resolve(UPLOAD_DIR, storedName)` must start with `UPLOAD_DIR + path.sep`.
- Write with flag `'wx'`, then insert the DB row in a transaction. If the insert fails, unlink the file.
- `uploads/` is outside `public/` and gitignored, and nothing in it is ever imported or executed.

**Serve** (`GET /api/files/[id]`). Load the Upload with its `request` and `orderPhoto.order`, then apply `canViewUpload(viewerOrNull, upload)`:
- **REQUEST_REFERENCE:** the request's customer, or a TAILOR when `request.status === 'OPEN'` or they have a bid on the request (which includes the awarded tailor).
- **ORDER_FINISHED:** the order's customer or tailor, or anyone (including anonymous) when `order.status === 'COMPLETED' && inPortfolio`.
- **Unattached upload:** the owner only.
- Everything else gets a **404**.

**Response headers**
- `Content-Type` from the DB allowlist;
- `X-Content-Type-Options: nosniff`;
- `Content-Security-Policy: default-src 'none'; sandbox`;
- `Content-Disposition: inline; filename="<id>.<ext>"`;
- `Cross-Origin-Resource-Policy: same-origin`;
- `Cache-Control: private, no-store`, or `public, max-age=3600` for portfolio items only.

**Rendering.** Use plain `<img>` and set `images.unoptimized: true`. The Next image optimizer would fetch the file without the viewer's cookie and would need `sharp`.

---

## 12. OWASP Top 10 mapping (2021 numbering; 2025 equivalents in brackets)

| Category | Risk in this app | Control | Where |
|---|---|---|---|
| A01 Broken Access Control: IDOR | Changing the id in a URL, form or bound argument to read or act on another user's request, bid, order, payment or file | Owner predicate in the WHERE clause of the same query; CAS `updateMany` with `count === 1`; 404 instead of 403; ids are lookup keys only | `lib/authz.ts`, `lib/bids.ts`, `lib/orders.ts`, `lib/payments/checkout.ts`, every `actions.ts` |
| A01: vertical escalation | A tailor calling customer actions, a role tampered with at signup, layout or middleware bypass | `requireRole`/`requireActionUser` first in every page, action and handler; role from the DB join; role immutable (zod + triggers); no middleware; `'use server'` files export guarded actions only | `lib/auth.ts`, `prisma/sql/triggers.sql` |
| A01: data exposure (blind bidding) | A competitor's name or numbers reaching the RSC payload | SQL-filtered relations, aggregate-only competition, threshold of 2, DTOs, no caching, actions return `{ok,error}`, payload test | `lib/bids.ts`, `tests/blind-bidding.test.ts` |
| A01: CSRF / open redirect | Forged cross-site POSTs; a `?next=` redirect | Next 14 action Origin/Host check + `assertSameOrigin()` (Origin, Sec-Fetch-Site); SameSite=Lax; GET handlers never mutate; logout is POST; the callback ignores cookies; no `next` parameter | `lib/csrf.ts`, `lib/auth.ts` |
| A01: files | Guessing upload ids | `canViewUpload()` for each purpose; 404 | `lib/authz.ts`, `app/api/files/[id]/route.ts` |
| A02 Cryptographic Failures [A04:2025] | Weak password hashes; replayable tokens; a forgeable callback; hardcoded secret | scrypt N=2^15 r=8 p=3 with versioned parameters and timingSafeEqual; 256-bit tokens with only the SHA-256 stored; HMAC-SHA256 with timingSafeEqual and a 300 s window; secret generated per install in a gitignored `.env` and validated at boot; Secure/`__Host-` cookies and HSTS in production | `lib/password.ts`, `lib/scrypt-core.mjs`, `lib/auth.ts`, `lib/payments/signature.ts`, `lib/env.ts`, `scripts/ensure-env.mjs`, `next.config.mjs` |
| A03 Injection [A05:2025]: SQL | Injection through filters | Prisma query builder only; raw unsafe calls banned by ESLint; zod on every input | `.eslintrc.json`, `lib/validation.ts` |
| A03: XSS | Script in request text, bid notes, chat, bio or reviews | React escaping; `react/no-danger`; no user-controlled href/src; CSP with `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` | components, `next.config.mjs` |
| A03: upload / path traversal | SVG or HTML polyglots, `../` names | Magic-byte allowlist (JPEG/PNG), uuid names, resolved-path check, sandbox CSP and nosniff on serve | `lib/uploads.ts`, `lib/image-sanitize.ts`, files route |
| A04 Insecure Design [A06:2025]: payment tampering | Client-set amount; order created on click or return URL; stale price paid | Amount read from DB rows; order created only in verified settlement; `bidVersion` check; revise/decline/cancel cancel checkouts; REFUND_DUE; read-only return page; triggers | `lib/payments/*`, triggers |
| A04: races / workflow abuse | Double clicks, concurrent callbacks, skipped states, second review or bid | CAS as the first write (SQLite writer lock); UNIQUE constraints (bid per tailor, order per request/bid/payment, review per order, providerRef); transition table + `orders_status_guard` | `lib/orders.ts`, `lib/payments/settle.ts`, schema |
| A04: abuse / DoS | Spam, large bodies, scrypt CPU exhaustion | DB rate limits (login, signup, bids, messages, payment init, polling 60/min); limiter runs before scrypt; 6 MB action limit; 2 KB callback limit; `take` <= 100 | `lib/rate-limit.ts`, `next.config.mjs` |
| A05 Security Misconfiguration [A02:2025] | Missing headers, framework fingerprint, verbose errors, mock left on, uploads or DB web-reachable | Headers (CSP, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP, HSTS in production); `poweredByHeader: false`; generic `error.tsx`/`not-found.tsx`; mock 404s unless `MOCK_PAYMENTS==='true'`; `uploads/` and `dev.db` outside `public/`; zod-validated env | `next.config.mjs`, `app/error.tsx`, `lib/env.ts` |
| A06 Vulnerable Components [A03:2025 Supply Chain] | Known-vulnerable framework versions (Next 14.x: 25 advisories incl. RCE); drifting versions | Moved to patched Next 16.4.6, React 19.2.9, zod 4.6.7, tsx 4.23.15; exact pins; committed lockfile; `npm run audit:deps` = 0; npm `allowScripts` limits install scripts to prisma and esbuild; minimal dependencies (no auth, upload or image libraries) | `package.json`, `package-lock.json` |
| A07 Authentication Failures | Brute force, enumeration, fixation, endless sessions | Per-account limiter (hashed email, covers unknown emails) + per-IP; generic errors; dummy-hash timing; password policy with common list; fresh session at login and signup; presented session deleted; 24 h idle and 7 d absolute; logout and password change revoke | `lib/auth.ts`, `lib/rate-limit.ts`, `app/(auth)/*/actions.ts` |
| A08 Integrity Failures | Forged or replayed callbacks; edited history or reviews; mass assignment | HMAC over timestamp + raw body; branded verified type; settle module import-restricted; append-only via code, query extension and triggers; `.strict()` schemas; data objects built field by field | `lib/payments/callback.ts`, `lib/db.ts`, triggers |
| A09 Logging Failures | Attacks or money movements leave no trace; secrets in logs | Append-only `AuditLog` + JSON stdout line covering LOGIN_*, SIGNUP, LOGOUT, RATE_LIMITED, AUTHZ_DENIED, PAYMENT_*, ORDER_*, REVIEW_CREATED, UPLOAD_REJECTED; scrubbed of passwords, tokens, cookies, signatures and message bodies | `lib/audit.ts` |
| A10 SSRF [folded into A01:2025] | Server fetching attacker URLs | No outbound fetch at all; the mock callback is in-process; `images.remotePatterns` empty; `redirect()` only to server-built relative paths | `lib/mock-provider.ts` |
| A10:2025 Exceptional Conditions | Failing open, partial writes, swallowed `redirect()` | `getCurrentUser` returns null on error; multi-step writes in `$transaction`; callback 5xx triggers a safe retry; boot aborts on bad env; `redirect()`/`notFound()` never wrapped in try/catch; known Prisma codes mapped to generic messages | `lib/auth.ts`, `lib/action-result.ts`, `lib/payments/settle.ts` |

---

## 13. Known limitations of this student build

1. Dependencies are audited clean today, but new advisories appear constantly. Re-run `npm run audit:deps` before every submission or deploy.
2. SQLite allows a single writer and Prisma 5 has no native enums or CHECK constraints. Strings + zod + triggers stand in for both, and the triggers must be re-applied by `predev`, which is automatic.
3. The mock provider shares the process and the secret with the merchant. A real provider would use its own key, asynchronous webhooks and real refunds. REFUND_DUE is only a terminal record.
4. The page CSP has no `script-src` yet, so it does not restrict scripts at all; React's escaping is the only XSS defense. Adding a nonce-based `script-src` (Next's `proxy.ts` can generate the nonce) is the most valuable hardening left.
5. Images are not re-encoded. Metadata is stripped, but polyglot risk is contained by nosniff, the sandbox CSP and the authorized route.
6. The IP-based rate limit trusts `x-forwarded-for` only when `TRUST_PROXY=true`, and the per-account key is the one that matters. A known account can be locked for 15 minutes by someone else.
7. There is no email verification, password reset or MFA. Signup can reveal that an email is taken; the signup rate limit mitigates this.
8. Showing a minimum always leaks a little over time, for example by watching it change. The threshold of 2 competitors keeps it unattributable.
9. Chat has up to 3 to 15 s of latency (polling). Polling writes a rate-limit row per request, which is fine locally.
10. Order cancellation, disputes, refunds and admin moderation are out of scope.
11. Finished photos of COMPLETED orders become public portfolio items when `inPortfolio` is set. Both parties are told this on the order page.
12. Sessions are not bound to a device, and there is no "log out other devices" page beyond password change.
