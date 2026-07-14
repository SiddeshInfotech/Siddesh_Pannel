# Security Implementations

This document outlines the security measures implemented across the `Siddesh Panel` application based on the current codebase.

## 1. Cryptography & Data Protection (`src/lib/crypto.ts`)
- **Password Hashing:** Uses Node's native `scrypt` key derivation function (64-byte key length) combined with random 16-byte salts, which is highly resistant to brute-force attacks.
- **Data Encryption (AES-256-GCM):** Implements Authenticated Encryption with Associated Data (AEAD) using AES-256-GCM and a master key (`LMS_MASTER_CEK`). This guarantees both confidentiality and authenticity of sensitive data, as any tampering will result in a failed authentication tag check.
- **Multi-Factor Authentication (MFA):** Custom implementation of HOTP/TOTP (Time-Based One-Time Passwords) using HMAC-SHA1. It generates base32 secrets and verifies codes with a configurable clock drift window.
- **Secure Recovery Codes:** Generates cryptographically secure, one-time use recovery codes. These codes are hashed via SHA-256 before storage to prevent exposure even if the database is compromised.

## 2. Route Protection & Edge Security (`src/proxy.ts`)
- **JWT Verification at the Edge:** Uses the `jose` library to verify ECDSA-signed JSON Web Tokens natively in the Next.js edge runtime on every request.
- **HttpOnly Cookies:** Authentication tokens (`admin_token`) are stored in `HttpOnly`, `Secure` (in production), and `SameSite=strict` cookies, and use the `__Host-` prefix in production, mitigating XSS and CSRF risks.
- **Single Admin Lock:** The middleware queries the database to strictly enforce that the JWT payload's email matches the *first and only* registered admin user, locking out any other validly signed tokens.
- **Stateful Session Revocation:** Token verification includes a stateful check against an `admin_sessions` database table to detect forcibly revoked or expired sessions (`sid`).
- **Path Traversal Prevention:** Decodes and sanitizes all incoming URI paths to block middleware bypass techniques (e.g., matching `..` or `//` patterns).
- **Strict Security Headers:** Injects best-practice HTTP headers on all responses:
  - `Strict-Transport-Security` (HSTS)
  - `X-Frame-Options: DENY` (Clickjacking protection)
  - `X-Content-Type-Options: nosniff` (MIME sniffing protection)
  - `Content-Security-Policy` (Strict CSP limiting scripts, styles, frames, and connections)
- **Cache Invalidation:** Enforces `Cache-Control: no-store` on all authenticated routes to prevent browsers from caching sensitive admin data.

## 3. Database Security & Access Control (`src/lib/supabase.ts`)
- **Client Privilege Separation:** Enforces a strict separation between the `supabase` public client (which uses the anon key and is restricted by Row Level Security) and the `supabaseAdmin` client.
- **Service Role Restriction:** The `supabaseAdmin` client, which uses the `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS, is strictly confined to server-side environments (`route.ts`, Server Actions, and async Server Components).

## 4. Server Actions & Input Validation (`src/app/schools/actions.ts`)
- **Session Verification:** Every restricted Server Action (e.g., `deleteSchoolAction`, `updateSchoolAction`) validates the caller's identity via `getAdminSession()` before executing.
- **Input Sanitization:** Uses a custom `sanitize()` function across user inputs (names, addresses, etc.) before writing to the database to mitigate Cross-Site Scripting (XSS) and injection attacks.
- **Format Validation:** Applies strict Regex validation (e.g., for phone numbers) on the server side, ensuring malicious or malformed data does not reach the database.
- **Safe Error Handling:** Catch blocks sanitize database errors. For example, instead of leaking raw PostgreSQL constraint violations (like `23505`), it maps them to safe, user-friendly error messages (e.g., "The School ID is already registered").
