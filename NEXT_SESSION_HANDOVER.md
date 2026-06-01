# KALOKEA — Session Handover & Roadmap (paste this to start next session)

## Project context
- E-commerce site. Two repos, both local + on GitHub (KALOKEA/Frontend, KALOKEA/Backend).
- Paths: `C:\KALOKEA\FRONTEND` and `C:\KALOKEA\BACKEND`.
- Frontend: Next.js 14.2.35, App Router, **static export** (`output: 'export'`) → Cloudflare Pages. Deploy = `git push origin develop:main`.
- Backend: NestJS 10 + Supabase (service-role key, RLS bypassed) + Razorpay + Brevo → Railway. Deploy = `git push` to main.
- Design follows the client HTML mockup: rose accent `#c8a4a5`, black `#0a0a0a`, cream, serif/sans. (NOTE: master plan said gold `#B8860B`/Cormorant — the code follows the mockup instead. Confirm which is canonical.)

## Current state: ~52% complete
**Working:** backend bootstrap (helmet, CORS, validation, rate limiting, JWT+refresh, OTP), all backend modules/CRUD, product/shop/cart/account pages, security hardening (IDOR fix, throttler, timing-safe webhook, CSP headers).

## CRITICAL BLOCKERS (do these first — they break core flow)
1. **DB schema is empty.** `src/database/migrations/001_initial_schema.sql` is 0 bytes. No reproducible database exists. Must be written (all tables: users, otp_sessions, categories, products, product_images, product_variants, carts, cart_items, addresses, orders, order_items, coupons, coupon_uses, reviews, wishlists, banners, returns, newsletter_subscribers, admin_activity_log).
2. **Checkout is broken.** Frontend sends `address_id` to `POST /orders`, but backend `CreateOrderDto` expects `address_snapshot` (object). No code resolves one to the other → every online order fails validation. Fix backend to load the address by id and snapshot it.
3. **Coupons silently ignored.** `ordersApi.create()` and the DTO accept `coupon_code`, but `orders.service.ts` never processes it — discounts don't apply. Wire coupon validation + discount into order totals.
4. **Cart never touches the backend.** Frontend cart is Zustand-local only; backend cart API + merge-on-login exist but are unused. Stock isn't re-validated until order creation. Wire frontend cart → backend, and merge guest cart on login.
5. **Auth lost on refresh.** `useAuthStore` has no persist + no bootstrap call to `/auth/me` (via refresh cookie) on app load → user is logged out on every hard refresh. Add session restore on load.
6. **Admin panel unusable.** Only `/admin` dashboard exists. The 9 sub-pages are missing (products, orders, inventory, coupons, banners, customers, reviews, returns, analytics) — sidebar links 404. Backend admin endpoints partly exist; build the pages.

## STRATEGIC DECISION (decide before Phase 3/9/11 work)
Static export gives **no SSR/ISR**, so product pages are client-rendered → **Google sees blank HTML** (the audit's biggest SEO failure), and `next.config` redirects/headers/ISR from the plan don't apply. Choose one:
- **(A) Stay static** on Cloudflare Pages, and prerender products via `generateStaticParams` at build (needs build-time product list + rebuild on catalog change). Simpler hosting, weaker freshness.
- **(B) Move to a server runtime** (Vercel, or Cloudflare via `@cloudflare/next-on-pages`) to get real ISR/SSR + proper product SEO. More setup, correct long-term.
This one decision drives Phases 3, 9, and 11.

## ROADMAP (priority order)
**P0 — core flow (blocks launch):** items 1–5 above.
**P1 — usable store:** admin sub-pages (item 6); product filters (backend `ProductQueryDto` is missing `size`/`colour`; add related-products API); email real line-items + return/refund/newsletter templates.
**P2 — launch quality & growth:** SEO (after the A/B decision — sitemap.ts, robots.ts, JSON-LD, OG images, canonicals); GA4 + events (add_to_cart, begin_checkout, purchase, view_item) + Merchant Center feed; performance (ISR, image optimization — currently `unoptimized:true`, backend caching); mobile polish (sticky add-to-cart, filter drawer, swipe gallery); stock-after-payment + OTP session cleanup + refresh-token rotation.
**P3 — handover:** fill `.env.example` (currently empty), API docs (Swagger), seed data, deployment runbook, tests.

## How we work next session
1. Paste this whole file as the first message.
2. Tell me to connect both folders (`C:\KALOKEA\FRONTEND`, `C:\KALOKEA\BACKEND`).
3. Pick ONE blocker to start (recommended order: #1 DB schema → #2 checkout → #3 coupons → #4 cart → #5 auth persist → #6 admin). Doing one fully > many half-done.
4. The Linux shell was DOWN last session — I may not be able to run `npm`/`git`/build. I edit files; you run `npm install` / `npm run build` / `git push` and paste any errors back.
5. After each fix: frontend `git push origin develop:main`; backend `git push` to main; watch Cloudflare/Railway logs.

## Reference docs in repo
- `BACKEND/SECURITY_AUDIT.md` — security findings + what's fixed + recommendations.
- `BACKEND/NEXT_SESSION_HANDOVER.md` — this file.
- Your `KALOKEA_CTO_Audit_Report.html` — full phase-by-phase gap analysis (52%).
