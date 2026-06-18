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
      if (!this.allowedIps.includes(normalised)) {
        this.logger.warn(`Admin access denied for IP ${normalised} (user ${user.id})`);
        throw new ForbiddenException('Admin access denied from this network');
      }
    }

    return true;
  }
}
