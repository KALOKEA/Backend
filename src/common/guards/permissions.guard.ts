import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '../decorators/permission.decorator';
import { isIpAllowed, parseAllowlist } from '../utils/ip-allowlist';

/**
 * Permission-aware admin guard (RBAC).
 *
 * Access rules:
 *   • role === 'admin'  → full access (permissions ignored)
 *   • role === 'staff'  → allowed only if the endpoint's required permission
 *                         (declared via @Permission) is in their permissions
 *                         array; endpoints with NO required permission are open
 *                         to any staff member (shared utilities, dashboard).
 *   • anything else     → forbidden.
 *
 * Enforces the same ADMIN_IP_ALLOWLIST network restriction as AdminGuard so
 * staff are bound by the same network policy as full admins.
 *
 * Requires `request.user` to be populated by JwtAuthGuard first. The user's
 * `role` and `permissions` are resolved fresh (≤5 min) by JwtStrategy, so
 * permission changes take effect without forcing a re-login.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);
  private readonly allowedIps: string[];

  constructor(
    private reflector: Reflector,
    private config: ConfigService,
  ) {
    this.allowedIps = parseAllowlist(this.config.get<string>('ADMIN_IP_ALLOWLIST'));
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // 1. Must be an admin-area user (admin or staff).
    if (!user || (user.role !== 'admin' && user.role !== 'staff')) {
      throw new ForbiddenException('Admin access required');
    }

    // 2. IP allowlist (only when ADMIN_IP_ALLOWLIST is configured).
    if (this.allowedIps.length > 0) {
      const clientIp = request.ip || request.socket?.remoteAddress || '';
      if (!isIpAllowed(clientIp, this.allowedIps)) {
        this.logger.warn(`Admin access denied for IP ${clientIp} (user ${user.id})`);
        throw new ForbiddenException('Admin access denied from this network');
      }
    }

    // 3. Full admins bypass per-section permission checks.
    if (user.role === 'admin') return true;

    // 4. Staff: resolve the required permission for this endpoint.
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No specific permission required → open to any admin-area user.
    if (!required) return true;

    const permissions: string[] = Array.isArray(user.permissions) ? user.permissions : [];
    if (permissions.includes(required)) return true;

    throw new ForbiddenException('You do not have permission to access this section');
  }
}
