# KALOKEA — Session Handover & Roadmap (paste this whole file as your first message)

## Project context
- Women's fashion e-commerce. Two repos, local + GitHub.
  - Frontend: `C:\KALOKEA\FRONTEND` → https://github.com/KALOKEA/Frontend → Cloudflare Pages. Deploy = `git push origin develop:main`.
  - Backend: `C:\KALOKEA\BACKEND` → https://github.com/KALOKEA/Backend → Railway. Deploy = `git push origin develop:main` (also push `develop`).
- Frontend: Next.js 14.2.35, App Router, static export (`output:'export'`, build dir `out`), Tailwind, Zustand.
- Backend: NestJS 10 + Supabase (service-role key, RLS bypassed in code) + Razorpay + Brevo. Supabase project ref `ygxbqdwtaryciskskokc`.
- Live: backend https://backend-production-73aa.up.railway.app/health · frontend on pages.dev (kalokea.in not purchased yet).
- Design follows client mockup: rose `#c8a4a5`, black `#0a0a0a`, cream. (Master plan said gold/Cormorant — code follows the mockup. Still unconfirmed which is canonical.)

## HOW WE WORK (read first)
- The Linux shell is often DOWN in this environment — assume Claude edits files; YOU run `npm install` / `npm run build` / `git`, and paste errors back.
- PowerShell does NOT accept `&&`. Run git commands one per line (or use `;`).
- Backend build check: `npm run build` (tsc). Frontend: `npm run build` (next build).
- Deploy each repo: `git add -A` → `git commit -m "..."` → `git push origin develop` → `git push origin develop:main`. Do NOT `git push origin main` (local main is stale → non-fast-forward).
- After any manual Supabase SQL: re-run the `GRANT ALL ... TO service_role` block or the API 403s.
- MONEY IS IN PAISE everywhere (DB, backend, frontend, Razorpay). ₹1 = 100 paise. Never multiply by 100 for Razorpay (order.total is already paise).

## DONE IN SESSION 2 (2026-06-01) — all pushed + deployed green
1. **DB schema (#1)** — wrote full `BACKEND/src/database/migrations/001_initial_schema.sql`: 19 tables (users, otp_sessions, categories, products, product_images, product_variants, carts, cart_items, addresses, coupons, orders, order_items, coupon_uses, reviews, wishlists, banners, returns, newsletter_subscribers, admin_activity_log) with FKs, indexes, updated_at triggers, RLS enabled, service_role GRANTs. RAN in Supabase SQL editor — tables live.
2. **Checkout (#2)** — `create-order.dto.ts` now accepts `address_id` (was rejected by `forbidNonWhitelisted`); `orders.service.ts` loads the address by id with a `user_id` ownership check and snapshots it; `address_snapshot` optional for guests; `payment_method` normalized to `razorpay`/`cod`; COD confirmation email now also reaches logged-in buyers.
3. **Coupons (#3)** — `coupons.service.ts` `validate()` returns `{valid:true, discount_amount, ...}` (fixed the FE contract that always showed "invalid"); added `redeem()`; `createOrder` validates the code, applies discount (capped at subtotal), persists `discount`/`coupon_id`/`coupon_code`, records `coupon_uses`; `OrdersModule` imports `CouponsModule`.
4. **MONEY-UNITS BUG (found + fixed)** — backend wrongly assumed rupees and did `total*100` for Razorpay (100× overcharge). Aligned backend to paise: `payments.service.ts` passes `order.total` directly; shipping `99900` (free >₹999) / `4900`; COD fee `4900`. Frontend `OrderSummary` now shows the COD fee so displayed total == charged total. Free-ship threshold standardized to ₹999 (backend was ₹599 — change back if business wants ₹599).
5. **Cart sync (#4, local-first + sync on login)** — fixed broken `lib/api/cart.ts` paths (`/cart/items`, `/cart/items/:id`, `session_id`); `useCartStore` gained `hydrate()` + `mergeOnLogin()`; logged-in add/update/remove/clear mirror to backend; guest items replay into the server cart on login (only those with `id === variant_id`, so no double-count); `app/login/page.tsx` calls `mergeOnLogin()`. This also unblocked logged-in checkout — `createOrder` reads the SERVER cart (by user_id), which was always empty under the old local-only cart.

Files touched: BE — `001_initial_schema.sql`, `orders/dto/create-order.dto.ts`, `orders/orders.service.ts`, `orders/orders.module.ts`, `coupons/coupons.service.ts`, `payments/payments.service.ts`. FE — `lib/api/cart.ts`, `lib/store/useCartStore.ts`, `app/login/page.tsx`, `components/checkout/OrderSummary.tsx`, `app/checkout/page.tsx`.

## NEXT MOVE — START WITH #5
**#5 Auth persist (recommended first — pairs with the cart work just shipped):**
- Problem: `lib/store/useAuthStore.ts` has no `persist` and no bootstrap call to `/auth/me` on app load → user is logged out on every hard refresh, and the cart can't hydrate.
- Do: on app load, attempt `authApi.me()` (rides the refresh httpOnly cookie via the client's auto-refresh on 401); if it succeeds call `setAuth(...)` then `useCartStore.getState().hydrate()`. Add a small bootstrap (top-level client provider / layout effect). Access token stays in memory.
- VERIFY FIRST: confirm `auth.controller.ts` actually sets the refresh token as an httpOnly cookie on `verify-otp` and `refresh` — the whole restore depends on it.

## REMAINING BLOCKERS / ROADMAP (priority order)
- **#6 Admin panel** — only `/admin` dashboard exists; build 9 sub-pages (products, orders, inventory, coupons, banners, customers, reviews, returns, analytics); sidebar links 404. Backend admin endpoints partly exist. Admin coupon form MUST store `value`/`min_order_value` in paise (×100, like `ProductForm`).
- **STRATEGIC DECISION (before SEO):** static export = client-rendered product pages = blank HTML to Google (biggest SEO gap in the audit). Choose (A) stay static on Cloudflare + `generateStaticParams` prerender (needs build-time product list + rebuild on catalog change) or (B) move to a server runtime (Vercel / `@cloudflare/next-on-pages`) for real SSR/ISR. Drives the SEO phases.
- **Product filters** — `ProductQueryDto` has `size`/`colour` but `products.service` ignores them; add filtering + a related-products API.
- **Operational env vars (Railway)** — `BREVO_API_KEY` (emails currently just log), `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET` (payments), `CLOUDINARY_API_KEY/SECRET` (uploads). Add test products.
- **P2 launch quality** — SEO (sitemap.ts, robots.ts, JSON-LD, OG, canonicals, old WooCommerce URL redirects), GA4 events (add_to_cart, begin_checkout, purchase, view_item) + Merchant Center feed, performance (ISR, image opt — currently `unoptimized:true`), mobile polish, stock-after-payment, OTP cleanup, refresh-token rotation.
- **P3 handover** — fill empty `.env.example`, Swagger API docs, seed data, deployment runbook, tests.

## KNOWN GOTCHAS
- `forbidNonWhitelisted: true` is on (main.ts) — any body field not in the DTO causes a 400. Add new fields to the DTO.
- API responses are wrapped by TransformInterceptor as `{ data: ... }`; the FE client unwraps `json.data`.
- Razorpay non-COD methods (upi/card/netbanking/wallet) are all normalized to `razorpay` server-side; DB constraint allows only `razorpay`/`cod`.
- Reference docs in repo: `BACKEND/SECURITY_AUDIT.md`, this file, `KALOKEA_CTO_Audit_Report.html` (re-audit in progress).

## SESSION START CHECKLIST
1. Paste this whole file.
2. Ask Claude to connect both folders: `C:\KALOKEA\FRONTEND` and `C:\KALOKEA\BACKEND`.
3. Say "start #5" (or pick another item). One blocker fully done > many half-done.
4. Claude edits files; you build/push and paste any errors.
