import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';

/**
 * In-process cache for token_version lookups.
 * Avoids a DB round-trip on every request while still catching revocations
 * within a short window (5 minutes). Use Redis if sub-minute revocation matters.
 */
interface CacheEntry { version: number; role: string; permissions: string[]; ts: number }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly versionCache = new Map<string, CacheEntry>();

  constructor(
    config: ConfigService,
    private db: DatabaseService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    // Only check token_version when the token actually carries it (tv field).
    // Tokens issued before this change won't have tv — they expire in ≤15m
    // naturally, so we skip the revocation check for backward compatibility.
    if (payload.tv !== undefined) {
      const now = Date.now();
      this.pruneCache(now);
      const cached = this.versionCache.get(payload.sub);

      if (!cached || now - cached.ts > CACHE_TTL_MS) {
        // Cache miss / expired — fetch current version, role AND permissions
        // from the DB and refresh the cache. Resolving role/permissions here
        // (rather than trusting the token) means an admin's change to a staff
        // member's access takes effect within the cache TTL, no re-login.
        const { data: user } = await this.db.client
          .from('users')
          .select('token_version, role, permissions')
          .eq('id', payload.sub)
          .maybeSingle();

        const currentVersion = user?.token_version ?? 0;
        const role = user?.role ?? payload.role;
        const permissions = Array.isArray(user?.permissions) ? user!.permissions : [];
        this.versionCache.set(payload.sub, { version: currentVersion, role, permissions, ts: now });

        if (currentVersion !== (payload.tv ?? 0)) {
          throw new UnauthorizedException('Session revoked');
        }

        return { id: payload.sub, role, permissions };
      }

      // Cache hit — version mismatch means this token has been revoked.
      if (cached.version !== (payload.tv ?? 0)) {
        throw new UnauthorizedException('Session revoked');
      }
      return { id: payload.sub, role: cached.role, permissions: cached.permissions };
    }

    // Legacy token without tv (no staff tokens are legacy) — trust the payload
    // role and grant no staff permissions.
    return { id: payload.sub, role: payload.role, permissions: [] };
  }

  /**
   * Bound the in-process cache so it can't grow forever (one entry per distinct
   * user otherwise lived for the process lifetime). Only does work once the map
   * is sizeable, so the hot path stays cheap. Drops expired entries first; if
   * still over the hard cap, clears the whole map (it self-rebuilds on demand).
   */
  private pruneCache(now: number): void {
    if (this.versionCache.size < 1000) return;
    for (const [key, entry] of this.versionCache) {
      if (now - entry.ts > CACHE_TTL_MS) this.versionCache.delete(key);
    }
    if (this.versionCache.size > 10000) this.versionCache.clear();
  }
}
