# Kalokea — Deployment Runbook

Step-by-step guide for deploying Kalokea from scratch or updating a running environment.  
Audience: any developer who needs to deploy without prior project knowledge.

---

## Architecture Quick Reference

| Layer | Service | URL |
|-------|---------|-----|
| Frontend | Cloudflare Pages (static export) | https://kalokea.pages.dev |
| Backend API | Railway (Dockerfile) | https://backend-production-73aa.up.railway.app |
| Database | Supabase (PostgreSQL) | Project ref: ygxbqdwtaryciskskokc |
| Images | Cloudinary | Cloud: kalokea |
| Email | Brevo (SMTP / API) | noreply@kalokea.in |
| Payments | Razorpay | Test / Live keys |

Git repos:
- Frontend: https://github.com/KALOKEA/Frontend
- Backend:  https://github.com/KALOKEA/Backend

Branch strategy: work on `develop`, deploy with `git push origin develop:main`.

---

## Part 1 — First-time Database Setup (Supabase)

Do this once, in order, before the first backend deploy.

### 1.1 Run migrations

Open Supabase → SQL Editor → New Query.  
Run each file in order (paste content, click Run):

```
src/database/migrations/001_initial_schema.sql   — all 20 tables, RLS, indexes
src/database/migrations/002_token_version.sql    — token_version column on users
src/database/migrations/003_otp_attempts.sql     — attempts column on otp_sessions
src/database/migrations/004_store_settings.sql   — store_settings singleton table
src/database/migrations/005_gst.sql              — GST columns, gst_ledger, exchanges
src/database/migrations/006_atomic_ops.sql       — atomic SQL RPCs (decrement_stock etc.)
src/database/migrations/007_shipping_settings.sql — shipping_fee, cod_fee in settings
```

### 1.2 Grant service_role permissions

After every migration run, execute this in the SQL editor:

```sql
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO service_role;
```

**Why:** Supabase does not auto-grant service_role on manually-created tables.  
Skipping this causes 403 errors on every API call that touches the new table.

### 1.3 Verify

Run `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1;`  
Expected: 20+ tables including `users`, `orders`, `gst_ledger`, `store_settings`, `exchanges`.

---

## Part 2 — Backend (Railway)

### 2.1 Create Railway project (first time only)

1. railway.app → New Project → Deploy from GitHub repo → KALOKEA/Backend
2. Select the `main` branch
3. Railway auto-detects the Dockerfile

### 2.2 Set environment variables

In Railway → your service → Variables, set ALL of the following:

**Required (app will not start without these):**
```
NODE_ENV=production
PORT=3001
SUPABASE_URL=https://ygxbqdwtaryciskskokc.supabase.co
SUPABASE_SERVICE_KEY=<service_role key from Supabase → Settings → API>
JWT_SECRET=<generate: openssl rand -base64 32>
JWT_REFRESH_SECRET=<generate: openssl rand -base64 32>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
ALLOWED_ORIGINS=https://kalokea.in,https://www.kalokea.in,https://kalokea.pages.dev
```

**Required for payments:**
```
RAZORPAY_KEY_ID=<from Razorpay dashboard>
RAZORPAY_KEY_SECRET=<from Razorpay dashboard>
RAZORPAY_WEBHOOK_SECRET=<set in Razorpay → Webhooks>
```

**Required for email:**
```
BREVO_API_KEY=<from Brevo → SMTP & API → API Keys>
BREVO_SENDER_EMAIL=noreply@kalokea.in
BREVO_SENDER_NAME=Kalokea
```

**Required for image uploads:**
```
CLOUDINARY_CLOUD_NAME=kalokea
CLOUDINARY_API_KEY=<from Cloudinary dashboard>
CLOUDINARY_API_SECRET=<from Cloudinary dashboard>
```

**Optional but recommended:**
```
SITE_URL=https://kalokea.in
ADMIN_EMAIL=admin@kalokea.in
SMS_PROVIDER=msg91                          (or: 2factor, generic)
SMS_API_KEY=<from MSG91 dashboard>
SMS_SENDER_ID=KALOKEA                       (MSG91 only — DLT-registered sender ID)
SMS_TEMPLATE_ID=<DLT OTP template ID>       (MSG91 only)
SELLER_NAME=Kalokea Fashion Pvt Ltd         (appears on GST invoices)
SELLER_GSTIN=<your GSTIN>
SELLER_STATE=Maharashtra
```

### 2.3 Deploy

```bash
# On your machine (not required if Railway auto-deploys on push):
git push origin develop:main
```

Railway rebuilds automatically on push to `main`. Watch logs:  
Railway → your service → Deployments → latest → View Logs.

**Expected healthy log output:**
```
[NestJS] Application is running on: http://0.0.0.0:3001
```

**Health check:** `curl https://backend-production-73aa.up.railway.app/health`  
Expected: `{"status":"ok"}`

### 2.4 Verify Razorpay webhook

In Razorpay dashboard → Webhooks → Add new:
- URL: `https://backend-production-73aa.up.railway.app/payments/webhook`
- Events: `payment.captured`, `payment.failed`
- Secret: same value as `RAZORPAY_WEBHOOK_SECRET` in Railway

---

## Part 3 — Frontend (Cloudflare Pages)

### 3.1 Create Cloudflare Pages project (first time only)

1. Cloudflare Dashboard → Pages → Create a project → Connect to Git
2. Select KALOKEA/Frontend repo, branch: `main`
3. Build settings:
   - Framework preset: Next.js (Static HTML Export)
   - Build command: `npm run build`
   - Build output directory: `out`

### 3.2 Set environment variables

In Cloudflare Pages → your project → Settings → Environment variables → Add for **Production**:

```
NEXT_PUBLIC_API_URL=https://backend-production-73aa.up.railway.app
NEXT_PUBLIC_RAZORPAY_KEY_ID=<Razorpay public key (rzp_test_... or rzp_live_...)>
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
NEXT_PUBLIC_SITE_URL=https://kalokea.in
```

### 3.3 Deploy

```bash
git push origin develop:main
```

Cloudflare Pages auto-builds on push to `main`. Watch: Cloudflare Dashboard → Pages → your project → Deployments.

**Build time:** ~2–3 minutes. The build fetches all product slugs at build time for static generation.

**If the build fails:**  
- Check that `NEXT_PUBLIC_API_URL` points to a live backend (Cloudflare Pages fetches products at build time via `lib/server/productsServer.ts`)  
- If the backend is down during build, `generateStaticParams` returns `[]` — pages still build but product pages will 404 until next redeploy

### 3.4 Custom domain (kalokea.in)

1. Cloudflare Pages → your project → Custom domains → Set up custom domain → `kalokea.in`
2. Add CNAME record: `kalokea.in → <pages-project>.pages.dev`  
   (Cloudflare handles SSL automatically)
3. Update `ALLOWED_ORIGINS` in Railway to include `https://kalokea.in`

---

## Part 4 — Seed Data (first time only)

After running migrations and deploying the backend, populate the database:

```bash
# In the Backend repo:
cp .env.example .env
# Fill SUPABASE_URL and SUPABASE_SERVICE_KEY in .env

npm install
npm run seed
```

This creates:
- 9 categories (New Arrivals, Dresses, Tops, Bottoms, Shoes, Bags, Accessories, Sale, Everything)
- 3 demo products with size/colour variants
- store_settings defaults (seller info, GST rate, shipping thresholds)

After seeding, trigger a Cloudflare Pages redeploy to rebuild the static product pages.

---

## Part 5 — Post-Deploy Checklist

Run through this after every fresh deployment:

**Backend:**
- [ ] `GET /health` returns `{"status":"ok"}`
- [ ] `POST /auth/send-otp` with email → OTP arrives in inbox
- [ ] `POST /auth/send-otp` with phone → OTP sent via SMS (if SMS_PROVIDER configured)
- [ ] `GET /categories` returns 9 categories
- [ ] `GET /products` returns seeded products

**Frontend:**
- [ ] Homepage loads (hero, featured products, categories)
- [ ] Product page loads with correct GST breakdown in OrderSummary
- [ ] Cart add/remove works
- [ ] Checkout → Razorpay modal opens (test key)
- [ ] Admin `/admin` panel loads (requires an admin-role user in DB)

**Set first admin user:**
```sql
UPDATE users SET role = 'admin' WHERE email = 'your-email@example.com';
```

---

## Part 6 — Routine Updates

### Code changes

```bash
# Backend:
cd KALOKEA/BACKEND
git add -A && git commit -m "feat: ..."
git push origin develop:main       # triggers Railway redeploy

# Frontend:
cd KALOKEA/FRONTEND
git add -A && git commit -m "feat: ..."
git push origin develop:main       # triggers Cloudflare Pages rebuild
```

### New catalog (no code change)

Product pages are static. When you add products via the Admin panel:
1. Cloudflare Pages → your project → Deployments → Retry last build  
   OR set up a Cloudflare Deploy Hook (recommended):
   - Pages → Settings → Builds & deployments → Deploy Hooks → Add
   - Copy the hook URL
   - In the Admin panel settings page, add it as `CLOUDFLARE_DEPLOY_HOOK`
   - The admin product-create endpoint can call it automatically on save

### New database migration

1. Write migration file: `src/database/migrations/00N_description.sql`
2. Run in Supabase SQL editor
3. Re-run the GRANT statement from Part 1.2
4. Push backend code if service/module changes are needed

---

## Part 7 — Environment Variables Summary

| Variable | Where to get it | Required? |
|----------|----------------|-----------|
| `SUPABASE_URL` | Supabase → Settings → API | Yes |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → service_role | Yes |
| `JWT_SECRET` | Generate: `openssl rand -base64 32` | Yes |
| `JWT_REFRESH_SECRET` | Generate: `openssl rand -base64 32` | Yes |
| `RAZORPAY_KEY_ID` | Razorpay dashboard | Yes (payments) |
| `RAZORPAY_KEY_SECRET` | Razorpay dashboard | Yes (payments) |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay → Webhooks | Yes (payments) |
| `BREVO_API_KEY` | Brevo → SMTP & API → API Keys | Yes (email) |
| `CLOUDINARY_API_KEY` | Cloudinary dashboard | Yes (uploads) |
| `CLOUDINARY_API_SECRET` | Cloudinary dashboard | Yes (uploads) |
| `SMS_PROVIDER` | `msg91` or `2factor` or `generic` | Optional |
| `SMS_API_KEY` | MSG91 / 2Factor dashboard | Optional |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Razorpay (public key) | Yes (Cloudflare) |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Google Analytics → Data streams | Optional |

---

## Part 8 — Troubleshooting

**403 on any API call after migration:**  
Re-run the GRANT statement from Part 1.2. Supabase doesn't auto-grant service_role.

**Backend crashes on startup:**  
Check Railway logs. Usually a missing required env var. The app calls `ConfigModule.validate()` at boot and throws on missing keys.

**Product pages 404 after adding products via admin:**  
Static export means new products don't appear until the next Cloudflare build. Trigger a redeploy manually or via Deploy Hook.

**Razorpay payment modal doesn't open:**  
`NEXT_PUBLIC_RAZORPAY_KEY_ID` not set in Cloudflare Pages env vars. Add it and redeploy.

**Emails not sending:**  
`BREVO_API_KEY` not set in Railway. OTP codes are logged to Railway console as fallback.

**SMS OTP not delivered:**  
`SMS_PROVIDER`, `SMS_API_KEY` not set. OTP is logged to Railway console. Users can still log in via email OTP.

**Image uploads fail:**  
`CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_CLOUD_NAME` not set in Railway.

**Stripe / payment webhook 400:**  
`RAZORPAY_WEBHOOK_SECRET` doesn't match the secret set in Razorpay dashboard.

---

*Last updated: June 4, 2026*
