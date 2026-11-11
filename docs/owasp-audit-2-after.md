# OWASP security audit — Ghurza (after fixes: re-check)

Same skill and auditor as the first run, asked to verify each fix against its rubric.

```
Security Review Progress:
- [x] Step 1: Map entry points and trust boundaries
- [x] Step 2: Load the references this code needs
- [x] Step 3: Sweep for candidate issues
- [x] Step 4: Triage every candidate
- [x] Step 5: Report findings
```

Step 1: Re-traced loginAction -> consume() and tailor request page -> totalBand(). Step 3: Read the 9 files changed in the git diff; recomputed totalBand() over every possible total.

[PARTIALLY FIXED] [MEDIUM] Blind-bid "range" decodes to a 5 KWD window
Status:     lib/bids.ts now uses fixed edges. Across every possible total, all 20 bands give identical output for every value inside them, so the decoding attack is gone. NEW FLAW: the open-ended top band (20,000 KWD and up) can hold only ONE possible value, because each part is capped at 10,000 KWD, so it reveals the exact total (residual: Low, bids at the cap only). The self-test skipped that band.
Fix:        Drop the 20000 edge so the top band covers 15,000-20,000 KWD; add a test that every band holds at least 2 possible totals.

[FIXED] [MEDIUM] Login lockout bypass at window rollover
Status:     lib/rate-limit.ts: only the request whose compare-and-set on the old windowStart returns count 1 passes; every loser retries and is counted in the new window. The retry recursion is bounded and correct, and the block write can only over-block.

[PARTIALLY FIXED] [MEDIUM] Unauthenticated login DoS (global or per-account)
Status:     lib/password.ts MAX_CONCURRENT=2 keeps 2 of libuv's 4 threads free, so the app-wide stall is fixed. (a) ~102 concurrent random-email logins still fill the queue; (b) the 6-guess per-account lockout is unchanged. Residual: Medium.
Fix:        Per-client limits at a reverse proxy plus TRUST_PROXY=true; progressive delay or CAPTCHA instead of a hard lockout.

[OPEN] [LOW] Signup reveals registered emails; no email verification
Fix:        Same response in both cases; complete signup through an emailed link.

[OPEN] [LOW] Common-password list has 15 entries
Fix:        Bundle a 10k+ list or a k-anonymity breached-password check.

[OPEN] [LOW] No password change, session revocation, reset or MFA
Fix:        Build changePasswordAction (verify, rate-limit, rehash, deleteMany sessions, createSession) and "sign out everywhere".

[PARTIALLY FIXED] [LOW] Page CSP does not restrict scripts
Status:     Cross-Origin-Opener-Policy: same-origin is now sent on every route. The CSP still has no script-src.
Fix:        Nonce from proxy.ts: script-src 'self' 'nonce-<n>' 'strict-dynamic'.

Auditor's count still open: Critical 0 · High 0 · Medium 1 · Low 5 (including the new top-band edge case)

---

## Follow-up fix made after the re-check

[FIXED] [LOW] Top band revealed the exact total at the cap
Status:     lib/bids.ts: the 20000 edge is removed, so the top band is "15000 KWD or more" (15,000–20,000 possible). New self-test: every band, including the open-ended one, must span at least 20 KWD of possible totals.
Test:       old edges -> FAIL (narrowest 0 KWD) · fixed -> ok (narrowest 22.5 KWD, 19 bands)

`npm run test:security`: 25/25 checks pass (14 app self-tests, 11 database-trigger checks).

**Open now:** Critical 0 · High 0 · Medium 1 (login DoS, needs a proxy) · Low 4 (signup enumeration, 15-entry password list, no password change/MFA, no script-src)
