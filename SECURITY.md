# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| Latest (`main`) | ✅ |
| Older branches | ❌ |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Email **aryankhamar20@gmail.com** with:

1. A description of the vulnerability and its potential impact
2. Steps to reproduce (proof of concept if possible)
3. Any suggested mitigations

We will acknowledge your report within **48 hours** and aim to release a fix within **7 days** for critical issues.

## Scope

In scope: the Kalokea backend API (`kalokea-backend`) and frontend (`kalokea-frontend`) including authentication, payment flow, order management, and admin endpoints.

Out of scope: Supabase infrastructure, Railway platform, Cloudflare Pages platform, Razorpay payment processor.

## Security measures

- OTP-based authentication with rate limiting and per-session brute-force lock
- JWT access tokens (15-min TTL) with server-side revocation via `token_version`
- Razorpay webhook signature verified with HMAC-SHA256 `timingSafeEqual`
- All admin endpoints require explicit role check (belt-and-suspenders over global guard)
- Input validated globally with `class-validator` (`whitelist` + `forbidNonWhitelisted`)
- HTTP security headers via `helmet` + Cloudflare Pages `_headers`
- Secrets validated at startup; app refuses to boot with missing required vars

See [SECURITY_AUDIT.md](SECURITY_AUDIT.md) for the full June 2026 audit report.
