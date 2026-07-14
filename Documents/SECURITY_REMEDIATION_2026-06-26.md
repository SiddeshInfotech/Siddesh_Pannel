# Security Remediation — 2026-06-26 (branch Security_22_06_26)

Hardening pass on the admin panel. All code changes pass `npx tsc --noEmit`.
Not runtime-tested (no deploy in this env). Items below marked **OPERATOR** require
action outside the code.

## Code fixes applied

| # | Severity | What | Files |
|---|----------|------|-------|
| 1 | CRITICAL | MFA challenge-token bypass closed. Session tokens now carry `purpose:'admin-session'`; `verifyAdminToken` + `proxy` require `purpose`+`role:'administrator'`+`sid` and a mandatory, fail-closed `admin_sessions` lookup. Pre-MFA challenge token can no longer act as a session. | `src/lib/auth.ts`, `src/proxy.ts` |
| 2 | HIGH | TOTP secret now from `crypto.randomBytes(20)` (160-bit CSPRNG), not `Math.random()`. | `src/lib/crypto.ts` |
| 3 | MED | Key separation: admin JWT uses `ADMIN_JWT_PRIVATE_KEY` (separate from device-license `PRIVATE_KEY`); TOTP secrets encrypted with `LMS_TOTP_ENC_KEY` (no longer `sha256(LMS_MASTER_CEK)`). Both have transition fallbacks. | `src/lib/auth.ts`, `src/proxy.ts`, `src/lib/crypto.ts` |
| 4 | MED | Recovery codes now 128-bit (was 32-bit); hash input normalized; 8 codes. | `src/lib/crypto.ts`, `src/app/api/auth/login/route.ts` |
| 5 | MED | Client IP from trusted `x-real-ip` (not spoofable leftmost XFF). Login rate-limit now fails CLOSED. | `src/lib/sanitize.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/activate/route.ts` |
| 6 | LOW | Proxy static-asset allow rule restricted to an extension allowlist (was bare `includes('.')` → auth bypass). | `src/proxy.ts` |

## Second pass — additional fixes

| # | Severity | What | Files |
|---|----------|------|-------|
| 8 | HIGH | **Activation keys (a credential) were generated with `Math.random()`** — predictable, enumerable. Now use a CSPRNG: server `crypto.randomInt` (unbiased), client Web Crypto `getRandomValues`; 10 chars over a 32-symbol unambiguous alphabet (~50 bits). | `src/app/payments/actions.ts`, `src/app/keys/KeysClient.tsx` |
| 9 | LOW | **Logout CSRF Origin check** used `startsWith(ALLOWED_ORIGIN)` → accepted look-alike hosts (`...vercel.app.evil.com`). Now exact-match. | `src/app/api/auth/logout/route.ts` |

### Audited clean this pass (no change needed)
- Android: no weak RNG, no trust-all TLS / hostname bypass, proper AES-GCM/CTR
  (the `RSA/ECB/OAEPPadding` string is JCE naming, not real ECB), no WebView,
  `allowBackup=false`, only the launcher `MainActivity` exported, no exported
  services/receivers/providers.
- Server actions/pages: every privileged action + page enforces `getAdminSession()`
  and throws/returns on null; inputs validated with zod + `sanitize()`.

### Known residuals (low impact — documented, not fixed)
- `/api/activate` has a ±5-min signature window but no nonce-replay store. Replay
  only re-activates the SAME device/key (idempotent) → low value; a nonce table
  is not worth it for the one-time offline model.
- `handshake_logs` stores the full `activation_key` in plaintext. If that table
  leaks, keys leak. Consider masking to a prefix or storing a hash if log access
  widens; today it is admin/service-role only.

## OPERATOR actions (required to fully close)

1. **Provision separated secrets on Vercel** (generate fresh, do not reuse):
   - `ADMIN_JWT_PRIVATE_KEY` — new EC P-256 PKCS8 PEM, ONLY for admin JWTs.
     `openssl ecparam -genkey -name prime256v1 -noout | openssl pkcs8 -topk8 -nocrypt`
   - `LMS_TOTP_ENC_KEY` — new random 32+ byte secret for TOTP-secret encryption.
     `openssl rand -base64 32`
   Until set, code falls back (domain-separated) and logs a warning. After setting
   `LMS_TOTP_ENC_KEY`, re-enroll admin MFA once so secrets re-encrypt under it.

2. **Native HMAC secret (#7, architectural residual).** The `LMS_HMAC_SECRET` baked
   into `liblmsnative.so` is extractable from any APK (XOR key sits beside the data).
   It does NOT leak content keys (those derive from server-only `LMS_MASTER_CEK`; the
   device only ever receives per-scope WRAPPED CEKs for its entitled class). To make
   the wrap path independent of this shared secret, deploy with the **Tier-3 Keystore**
   path (device sends `device_wrap_pubkey`) and set:
   - `LMS_DISABLE_LEGACY_CEK=true` (stop sending the all-class master CEK)
   - `LMS_ENFORCE_SIGNATURE=true` (fail closed if `LMS_HMAC_SECRET` ever unset)

3. **Rotate the signing keystore + purge git history.** The release keystore password
   (`lms7878@@!!##lms7878`) is present in git history (commits `8d7cf17`, `d4a59c7`).
   Rotate the keystore + password, re-bake `SecurityChecks.SIG_BYTES`, then purge with
   git-filter-repo/BFG and force-push.

4. **Deploy `scripts/create_login_rate_limits.sql`** in Supabase if not already — the
   login limiter now FAILS CLOSED, so the `bump_login_rate_limit` RPC must exist or
   admin login is blocked.
