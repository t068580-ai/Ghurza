# OWASP security audit — Ghurza (before fixes)

Skill: owasp-security (github.com/agamm/claude-code-owasp @ 1ae29cb), run with its own 5-step workflow, triage rubric and report format.

```
Security Review Progress:
- [x] Step 1: Map entry points and trust boundaries
- [x] Step 2: Load the references this code needs
- [x] Step 3: Sweep for candidate issues
- [x] Step 4: Triage every candidate
- [x] Step 5: Report findings
```

Step 1: 15 Server Actions, 3 route handlers (payment callback trusts only HMAC; files; messages), pages, multipart uploads, cookies, `X-Forwarded-For` only when `TRUST_PROXY=true`. No middleware/`proxy.ts`; every entry point runs its own guard.
Step 2: Loaded `languages.md` (JS/TS), `config-and-supply-chain.md`, `review-checklist.md`. LLM/Agentic sections: not applicable (no model calls).
Step 4: Dropped the 6-photo cap race (own-data only), audit-table growth, the `allowScripts` field, the 3 MB vs 5 MiB mismatch.

## Findings

[MEDIUM] Blind-bid "range" can be decoded to a 5 KWD window (CWE-200, OWASP A01:2025)
Location:   lib/bids.ts:27-31 (rendered at app/tailor/requests/[id]/page.tsx:78-80)
Path:       other tailors' bids -> bid.aggregate _min.totalFils -> totalBand() -> range shown to any tailor once 2 other bids exist (a sock puppet suffices)
Impact:     The band width is derived from the hidden value itself, so "from" is always 9x or 10x the width. "225-249" means 245-249.999; "900-999" means 995-999.999 (checked every total from 2 to 2000 KWD). Review fix #5 does not hold; cross-tailor leak.
Fix:        Bands from fixed edges that never depend on the value, e.g. EDGES = [0,25,50,100,150,200,300,400,600,800,1200,...] KWD, plus a test that every value in a band maps to that same band.
Confidence: Confirmed (pure function, values computed)

[MEDIUM] Login lockout bypass at window rollover (CWE-307, CWE-362, OWASP A07:2025)
Location:   lib/rate-limit.ts:32-39 (called from app/actions/auth.ts:30)
Path:       unauthenticated parallel loginAction POSTs -> consume() -> stale windowStart -> return true
Impact:     After a window or block expires, every request whose upsert lands before the first reset sees the old windowStart and returns true without checking updateMany's count. A burst of about 100 guesses gets through every 15 minutes instead of 5, so online guessing runs about 20x faster.
Fix:        const r = await db.rateLimit.updateMany(...); if (r.count === 1) return true; return consume(key, limit, windowMs, blockMs) — plus a self-test that starts from an expired window.
Confidence: Likely (logic error certain; burst size depends on query scheduling)

[MEDIUM] Unauthenticated login DoS: global or per-account (CWE-770, CWE-645, OWASP A06:2025)
Location:   lib/password.ts:15-27; app/actions/auth.ts:29-48; lib/audit.ts:48-53
Path:       (a) ~105 concurrent logins with random emails (fresh keys) -> password queue full -> real users get "Too many attempts"; (b) 6 wrong guesses per 15 min against a known email -> that user is locked out
Impact:     No per-client limit unless TRUST_PROXY=true. MAX_CONCURRENT=4 equals libuv's default thread pool, so a flood also stalls file serving and gzip app-wide (the code comment says the opposite).
Fix:        Per-client limits at a reverse proxy plus TRUST_PROXY=true; MAX_CONCURRENT below UV_THREADPOOL_SIZE (or a larger pool); progressive delay or CAPTCHA instead of a hard lockout.
Confidence: Likely

[LOW] Signup reveals which emails are registered; no email verification (CWE-204, OWASP A07:2025)
Location:   app/actions/auth.ts:80-81, 104
Path:       signup with a target email -> P2002 -> a different message than for a new email
Impact:     Confirms that accounts exist, which helps lockout (b). Anyone can register under another person's email.
Fix:        Same response in both cases, and complete signup through an emailed link.
Confidence: Confirmed

[LOW] Common-password list has only 15 entries (CWE-521, OWASP A07:2025)
Location:   lib/password.ts:84-88
Path:       signup password -> COMMON.has()
Impact:     "Password123!" and "1q2w3e4r5t6y" are accepted. DESIGN.md §4 claims ~10k entries; ASVS 5.0 6.2.4 requires at least the top 3000.
Fix:        Bundle a 10k+ common-password list, or a k-anonymity breached-password check.
Confidence: Confirmed

[LOW] No password change, session revocation, reset or MFA (CWE-613, CWE-308, OWASP A07:2025)
Location:   app/actions/auth.ts (no changePasswordAction, although DESIGN.md describes one)
Path:       n/a (missing control)
Impact:     A user with a stolen password or cookie can't change the password or end other sessions. Logout ends only the current session; a stolen session that stays in use lasts up to 7 days.
Fix:        Build the documented action: verify, rate-limit, rehash, delete all of the user's sessions, then createSession(). Add "sign out everywhere"; MFA and reset once email exists.
Confidence: Confirmed

[LOW] Page CSP does not restrict scripts (CWE-693, OWASP A02:2025)
Location:   next.config.mjs:8-13
Path:       no XSS sink found (React escaping, no dangerouslySetInnerHTML, every src/href built on the server); defense-in-depth only
Impact:     Any future XSS would run unrestricted. The COOP header listed in DESIGN.md §12 is not actually sent.
Fix:        Nonce CSP from proxy.ts: default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'. Add Cross-Origin-Opener-Policy: same-origin.
Confidence: Confirmed

**Summary:** Critical 0 · High 0 · Medium 3 · Low 4 · Info 0

## Clean categories

- Input Handling / Injection (A05)
- Access Control (A01): ownership in every WHERE clause, compare-and-set updates, Origin and Sec-Fetch-Site checks, no open redirects, no CORS
- SSRF
- File Handling: magic bytes, allowlist rebuild, uuid names, confinement, sandbox CSP, nosniff
- Serialization & Data Integrity (A08): HMAC checked before parsing, timingSafeEqual, idempotent settlement, triggers
- Data Protection (A04): scrypt, 256-bit session tokens stored as SHA-256, secrets in a gitignored `.env`
- Dependencies & Supply Chain (A03): exact pins, integrity hashes, minimal install scripts
- Error Handling & Logging (A09/A10)
- LLM / Agentic: not applicable
