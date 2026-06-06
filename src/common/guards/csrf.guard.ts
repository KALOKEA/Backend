import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'

/**
 * CSRF guard for cookie-only endpoints (/auth/refresh, /auth/logout).
 *
 * These endpoints authenticate via the httpOnly `refresh_token` cookie and are
 * therefore vulnerable to CSRF attacks when `sameSite: 'none'` is set (required
 * for cross-origin Railway ↔ Cloudflare Pages architecture).
 *
 * Mitigation: verify the `Origin` or `Referer` header matches our known front-
 * ends. Browsers always send Origin on cross-origin POST requests; legitimate
 * same-origin requests may omit it, so we also accept a missing Origin if the
 * Referer is present and matches.
 *
 * Additional defense: require the `X-Requested-With: XMLHttpRequest` header,
 * which browsers never add to simple cross-origin form submissions.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowed: string[]

  constructor() {
    const base = [
      'https://kalokea.pages.dev',
      'https://kalokea.in',
      'https://www.kalokea.in',
    ]
    // Allow localhost in development
    if (process.env.NODE_ENV !== 'production') {
      base.push('http://localhost:3000', 'http://localhost:3001')
    }
    this.allowed = base
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { headers: Record<string, string> }>()

    const origin: string = (req.headers['origin'] as string) ?? ''
    const referer: string = (req.headers['referer'] as string) ?? ''
    const xrw: string = (req.headers['x-requested-with'] as string) ?? ''

    // If Origin header is present, it MUST match an allowed origin
    if (origin && !this.allowed.some(o => origin === o)) {
      throw new ForbiddenException('CSRF: origin not allowed')
    }

    // If Origin is absent, check Referer (for same-origin browser requests)
    if (!origin && referer && !this.allowed.some(o => referer.startsWith(o))) {
      throw new ForbiddenException('CSRF: referer not allowed')
    }

    // Require X-Requested-With header (SPA sets this; cross-origin forms cannot)
    if (xrw.toLowerCase() !== 'xmlhttprequest') {
      throw new ForbiddenException('CSRF: X-Requested-With header missing')
    }

    return true
  }
}
