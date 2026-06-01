# KALOKEA — Security Audit & Hardening (1 June 2026)

Full-stack review of the KALOKEA e-commerce app (Next.js static frontend on Cloudflare Pages + NestJS/Supabase backend on Railway). This documents what was found, what was fixed in this pass, and what still needs attention before/after launch.

---

## 1. Critical — Fixed

### 1.1 IDOR: any logged-in user could read any order
`GET /orders/:id` required only a valid login, but never checked that the order belonged to the requester. Any authenticated user could enumerate order IDs and read other customers' **full address, phone, email, and items** — a serious PII breach.

**Fix:** `findOne()` now enforces ownership — a normal user can only read their own order; admins can read any. Returns `404` (not `403`) so order existence isn't leaked. Because Supabase is accessed with the **service-role key (RLS is bypassed)**, this authorization *must* live in application code — which it now does.

Files: `src/orders/orders.service.ts`, `src/orders/orders.controller.ts`.

---

## 2. High — Fixed

### 2.1 No rate limiting anywhere (OTP brute-force & OTP-bombing)
The login is OTP-based but had **no throttling**. An attacker could (a) spam `send-otp` to bomb a victim's inbox / run up email cost, or (b) brute-force the 6-digit `verify-otp` code within the 5-minute window.

**Fix:** Added `@nestjs/throttler` (already a dependency):
- Global default: **100 requests/min per IP**.
- `POST /auth/send-otp`: **3/min per IP**.
- `POST /auth/verify-otp`: **10/min per IP**.
- `trust proxy` enabled in `main.ts` so the real client IP is used behind Railway/Cloudflare (otherwise all users would share one limit).

Files: `src/app.module.ts`, `src/auth/auth.controller.ts`, `src/main.ts`.

---

## 3. Medium — Fixed

### 3.1 Webhook signature compared non-constant-time
The Razorpay webhook signature used `!==`, which is theoretically vulnerable to a timing side-channel.

**Fix:** Switched to `crypto.timingSafeEqual` with a length guard. File: `src/payments/payments.service.ts`.

### 3.2 Overselling / negative stock
`createOrder` decremented stock without checking availability, so concurrent or crafted requests could drive stock negative.

**Fix:** Added a per-item stock check that rejects the order if any variant has insufficient stock. File: `src/orders/orders.service.ts`.

### 3.3 Next.js known vulnerabilities (build dependency)
Build was on Next.js 14.2.3, flagged for CVE-2025-66478 (RSC RCE) and related advisories.

**Fix:** Bumped to **14.2.35** (`next` + `eslint-config-next`). Note: the headline RCE targets server-side React Server Components; this site is a **static export with no server runtime**, so it was not exploitable in production — but patching the dependency is still correct.

### 3.4 Missing HTTP security headers on the frontend
Static export ignores `next.config` `headers()`, so the site shipped without CSP, HSTS, anti-clickjacking, etc.

**Fix:** Added `public/_headers` (Cloudflare Pages) with `Content-Security-Policy` (scoped to self + Cloudinary + the Railway API + Razorpay), `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `Permissions-Policy`.

---

## 4. Verified — Already Correct (no change needed)

- **Order totals computed server-side** from DB variant prices — the client cannot tamper with price. ✔
- **Razorpay secret key never reaches the frontend** — only the public `key_id` is returned at order time; payment truth comes from the signed webhook. ✔
- **Auth token handling**: access token in memory (not `localStorage`), refresh token in an httpOnly + Secure + SameSite cookie, separate refresh secret. ✔
- **Addresses & users endpoints** scope every query by `user_id` — no IDOR. ✔
- **Input validation**: global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` + `transform`; DTOs validate phone/email formats. ✔
- **Secrets**: no `.env` committed in either repo; `.gitignore` covers it; only `.env.example` is tracked. ✔
- **CORS**: origin allowlist via `ALLOWED_ORIGINS`. ✔ (Make sure that env var lists the production frontend origin — see §6.)

---

## 5. Recommended next (not changed — needs testing / product decisions)

1. **Stock lifecycle for online payments.** Stock is currently reduced at order *creation*, but `POST /orders` is public and online payment isn't yet confirmed at that point. Two problems: (a) unpaid/abandoned online orders permanently consume stock, and (b) `payment.failed` doesn't restore it. Recommended: for non-COD, reserve stock with a short TTL or only decrement in the `payment.captured` webhook, and restore on `payment.failed`. Needs testing against the real Razorpay flow.

2. **Logged-in orders are created as guest.** `POST /orders` is `@Public()`, so even an authenticated user's order has `user_id = null` and won't appear in `/orders/my`. Consider making the route authenticated-optional (parse the JWT if present) rather than fully public.

3. **Refresh-token rotation / revocation.** Refresh tokens are valid 30 days with no rotation or server-side revocation; a stolen token stays valid. Consider rotating on each refresh and storing a revocation list / token version on the user.

4. **OTP attempt lock per session.** Throttling is now per-IP; also consider locking an individual OTP session after N failed attempts (defense if an attacker rotates IPs).

5. **Harden the auth lookup query.** `verifyOtp` builds a Supabase `.or(...)` filter via string interpolation. Risk is low (DTOs validate format) but prefer explicit `.eq('phone', ...)` / `.eq('email', ...)` to remove any PostgREST filter-injection surface.

6. **Tighten CSP later.** The CSP allows `'unsafe-inline'` for scripts/styles (needed without nonces in static export). A nonce/hash-based CSP is a future hardening step.

7. **npm audit.** After `npm install`, run `npm audit` on both repos and patch remaining transitive advisories where non-breaking.

---

## 6. Deploy checklist

**Backend (NestJS / Railway):**
- Confirm env vars are set: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `ALLOWED_ORIGINS` (must include the live frontend origin, e.g. `https://kalokea.pages.dev`).
- `npm install` (no new packages required — throttler already present), then build/deploy as usual.

**Frontend (Next.js / Cloudflare Pages):**
- `npm install` (pulls Next.js 14.2.35), `npm run build` to verify, then commit + push.
