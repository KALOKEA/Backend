import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);
  // Comma-separated list of allowed CIDRs/IPs in ADMIN_IP_ALLOWLIST env var.
  // Example: ADMIN_IP_ALLOWLIST=203.0.113.10,198.51.100.0
  // If the env var is empty or unset, IP check is SKIPPED (open to any authenticated admin).
  // Set it in Railway to lock admin routes to your office/VPN IP(s).
  private readonly allowedIps: string[];

  constructor(private config: ConfigService) {
    const raw = this.config.get<string>('ADMIN_IP_ALLOWLIST') || '';
    this.allowedIps = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // 1. Role check — must be admin
    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }

    // 2. IP allowlist check (only when ADMIN_IP_ALLOWLIST is configured)
    if (this.allowedIps.length > 0) {
      // req.ip is the real client IP when trust proxy = 1 is set in main.ts
      const clientIp = request.ip || request.socket?.remoteAddress || '';
      // Strip IPv6-mapped IPv4 prefix (::ffff:1.2.3.4 → 1.2.3.4)
      const normalised = clientIp.replace(/^::ffff:/, '');
      // Supports exact IPs (IPv4 + IPv6) AND IPv4 CIDR ranges (e.g. 203.0.113.0/24).
      if (!this.allowedIps.some((entry) => this.ipMatches(normalised, entry))) {
        this.logger.warn(`Admin access denied for IP ${normalised} (user ${user.id})`);
        throw new ForbiddenException('Admin access denied from this network');
      }
    }

    return true;
  }

  /** Convert a dotted IPv4 string to a 32-bit unsigned int, or null if invalid. */
  private ipToLong(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let n = 0;
    for (const p of parts) {
      const o = Number(p);
      if (!Number.isInteger(o) || o < 0 || o > 255) return null;
      n = (n << 8) + o;
    }
    return n >>> 0;
  }

  /** True if clientIp matches an allowlist entry — exact match or IPv4 CIDR range. */
  private ipMatches(clientIp: string, entry: string): boolean {
    if (clientIp === entry) return true; // exact (also handles IPv6)
    if (!entry.includes('/')) return false;
    const [range, bitsStr] = entry.split('/');
    const bits = Number(bitsStr);
    const ipLong = this.ipToLong(clientIp);
    const rangeLong = this.ipToLong(range);
    if (ipLong === null || rangeLong === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
      return false;
    }
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipLong & mask) === (rangeLong & mask);
  }
}
