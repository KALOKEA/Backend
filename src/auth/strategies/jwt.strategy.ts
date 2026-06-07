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
interface CacheEntry { version: number; ts: number }
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
      const cached = this.versionCache.get(payload.sub);

      if (!cached || now - cached.ts > CACHE_TTL_MS) {
        // Cache miss / expired — fetch current version from DB and refresh cache.
        const { data: user } = await this.db.client
          .from('users')
          .select('token_version')
          .eq('id', payload.sub)
          .maybeSingle();

        const currentVersion = user?.token_version ?? 0;
        this.versionCache.set(payload.sub, { version: currentVersion, ts: now });

        if (currentVersion !== (payload.tv ?? 0)) {
          throw new UnauthorizedException('Session revoked');
        }
      } else if (cached.version !== (payload.tv ?? 0)) {
        // Cache hit — version mismatch means this token has been revoked.
        throw new UnauthorizedException('Session revoked');
      }
    }

    return { id: payload.sub, role: payload.role };
  }
}
