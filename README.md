# Kalokea — Backend API

NestJS REST API for the [Kalokea](https://kalokea.pages.dev) fashion e-commerce platform. Deployed on Railway.

## Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 10 (Node / Express) |
| Database | Supabase (PostgreSQL) — service-role key, RLS bypassed in app layer |
| Auth | OTP (email + SMS) → JWT 15 min access + 30 day httpOnly refresh |
| Payments | Razorpay (order, verify, webhook) |
| Shipping | ShipRocket (labels, manifest, NDR, tracking) |
| Email | Brevo (transactional) |
| Images | Cloudinary |
| Deploy | Railway — auto-deploy on push to `main` |

## Local setup

```bash
cp .env.example .env   # fill required secrets
npm install
npm run start:dev      # ts-node hot-reload on port 3001
```

Swagger UI: `http://localhost:3001/api/docs`

## Environment variables

**Required** (app refuses to boot if missing):

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service-role key (bypasses RLS) |
| `JWT_SECRET` | ≥32 chars — access token signing |
| `JWT_REFRESH_SECRET` | ≥32 chars — refresh token signing |

**Feature** (app boots with warnings if missing):

`ALLOWED_ORIGINS`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `BREVO_API_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`, `SHIPROCKET_PICKUP_LOCATION`, `SHIPROCKET_PICKUP_PINCODE`, `SHIPROCKET_WEBHOOK_TOKEN`

Set `SWAGGER_DISABLED=true` in production to hide `/api/docs`.

## Database migrations

SQL files live in `src/database/migrations/`. Run in order via Supabase SQL Editor.
After any migration that creates or alters a table, grant service-role:

```sql
GRANT ALL ON TABLE your_table TO service_role;
```

## Build & deploy

```bash
npm run build   # tsc → dist/
npm start       # node dist/main.js
```

## API overview

| Prefix | Auth | Description |
|---|---|---|
| `/auth` | Public | OTP send/verify, refresh, logout |
| `/products` | Public / Admin | Catalogue, search, variants |
| `/cart` | Optional JWT | Server-side cart |
| `/orders` | Optional JWT | Place, track, invoice, cancel |
| `/payments` | Optional JWT | Razorpay flow + webhook |
| `/returns` | JWT | Return requests |
| `/admin/*` | Admin JWT | Dashboard, audit log |
| `/shiprocket/*` | Admin JWT | Shipment management |
| `/health` | Public | Liveness + DB check |

Full interactive docs at `/api/docs` (Swagger UI).

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure policy and [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for the June 2026 audit report.

Key hardening:
- Rate limiting: 100 req/min global; 3/min OTP send; 10/min OTP verify
- Webhook: HMAC-SHA256 `timingSafeEqual` signature check
- Tokens: 15-min access + per-user `token_version` revocation
- Input: `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` globally
- Headers: `helmet`, `compression`, CORS allowlist via `ALLOWED_ORIGINS`
