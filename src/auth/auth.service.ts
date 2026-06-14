import { Injectable, BadRequestException, UnauthorizedException, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { SmsService } from '../sms/sms.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private db: DatabaseService,
    private jwt: JwtService,
    private config: ConfigService,
    private email: EmailService,
    private sms: SmsService,
  ) {}

  async sendOtp(dto: SendOtpDto) {
    const identifier = dto.phone || dto.email;
    if (!identifier) throw new BadRequestException('Phone or email required');

    // Per-identifier cooldown (60 s): prevents distributed OTP flooding attacks
    // on a victim's phone/email even when per-IP rate limits are bypassed via
    // rotating IPs. We check for any unused session created in the last 60 s.
    const cooldownThreshold = new Date(Date.now() - 60 * 1000).toISOString();
    const { data: recentSession } = await this.db.client
      .from('otp_sessions')
      .select('created_at')
      .eq('identifier', identifier)
      .eq('used', false)
      .gt('created_at', cooldownThreshold)
      .limit(1)
      .maybeSingle();
    if (recentSession) {
      throw new BadRequestException('OTP already sent. Please wait 60 seconds before requesting a new code.');
    }

    // Hourly cap: max 5 OTPs per identifier per hour. Guards against sustained
    // flooding that rotates around the 60 s cooldown (e.g. automated script
    // waiting exactly 61 s between requests). Independent of per-IP throttling.
    const hourThreshold = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: hourlyCount } = await this.db.client
      .from('otp_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('identifier', identifier)
      .gt('created_at', hourThreshold);
    if ((hourlyCount ?? 0) >= 5) {
      throw new BadRequestException('Too many OTP requests. Please try again in an hour.');
    }

    const otp = randomInt(100000, 1000000).toString();
    const otp_hash = await bcrypt.hash(otp, 10);
    const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Delete all prior unused sessions for this identifier before inserting a new
    // one. Prevents unbounded table growth and closes session-enumeration risk (SEC-4).
    await this.db.client
      .from('otp_sessions')
      .delete()
      .eq('identifier', identifier)
      .eq('used', false);

    const { error: insertErr } = await this.db.client
      .from('otp_sessions').insert({ identifier, otp_hash, expires_at });
    if (insertErr) throw new InternalServerErrorException('Failed to create OTP session');

    // Send via email if email provided, otherwise log (SMS to be added later)
    if (dto.email) {
      await this.email.sendOtp(dto.email, otp);
    } else {
      // SmsService is provider-agnostic — set SMS_PROVIDER + SMS_API_KEY in Railway.
      // Supported: msg91 (recommended), 2factor, generic.
      // If env vars are absent, SmsService logs a warning but never throws.
      await this.sms.sendOtp(dto.phone!, otp);
    }

    return { message: 'OTP sent successfully' };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const identifier = dto.phone || dto.email;
    if (!identifier) throw new BadRequestException('Phone or email required');

    const { data: sessions } = await this.db.client
      .from('otp_sessions')
      .select('*')
      .eq('identifier', identifier)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    if (!sessions || sessions.length === 0)
      throw new UnauthorizedException('OTP expired or not found');

    const session = sessions[0];

    // Per-session brute-force lock (IP-independent): after MAX_ATTEMPTS wrong
    // guesses the session is consumed, so a new code must be requested. This
    // closes the rotating-IP bypass of the per-IP throttler.
    const MAX_ATTEMPTS = 5;
    if ((session.attempts ?? 0) >= MAX_ATTEMPTS) {
      // Best-effort consume — if DB fails, the session is still expired by its expires_at
      await this.db.client.from('otp_sessions').update({ used: true }).eq('id', session.id);
      throw new UnauthorizedException('Too many attempts. Please request a new code.');
    }

    const valid = await bcrypt.compare(dto.otp, session.otp_hash);
    if (!valid) {
      const attempts = (session.attempts ?? 0) + 1;
      const { error: attemptsErr } = await this.db.client
        .from('otp_sessions')
        .update({ attempts, ...(attempts >= MAX_ATTEMPTS ? { used: true } : {}) })
        .eq('id', session.id);
      if (attemptsErr) {
        this.logger.error(`Failed to record OTP attempt for session ${session.id}: ${attemptsErr.message}`);
      }
      throw new UnauthorizedException(
        attempts >= MAX_ATTEMPTS ? 'Too many attempts. Please request a new code.' : 'Invalid OTP',
      );
    }

    // SECURITY: Mark the session used BEFORE issuing tokens.
    // If this write fails, we must NOT issue a token — the OTP would remain
    // replayable and an attacker could mint unlimited valid sessions.
    const { error: markUsedErr } = await this.db.client
      .from('otp_sessions')
      .update({ used: true })
      .eq('id', session.id);
    if (markUsedErr) {
      this.logger.error(`Failed to mark OTP session ${session.id} as used: ${markUsedErr.message}`);
      throw new InternalServerErrorException('Failed to complete sign-in. Please try again.');
    }

    // Explicit, parameter-bound lookup (no string interpolation into the
    // PostgREST .or() filter — avoids any filter-injection surface).
    const baseQuery = this.db.client.from('users').select('*');
    const { data: existing } = await (dto.phone
      ? baseQuery.eq('phone', dto.phone)
      : baseQuery.eq('email', dto.email)
    ).maybeSingle();

    let user = existing;
    if (!user) {
      const { data: newUser } = await this.db.client
        .from('users')
        .insert({
          phone: dto.phone || null,
          // If phone is the OTP identifier but email was also provided, save both
          email: dto.email || null,
          accepted_terms: dto.accepted_terms === true,
          ...(dto.name?.trim() ? { name: dto.name.trim() } : {}),
        })
        .select()
        .single();
      user = newUser;
    } else {
      // Update existing user: fill in any missing fields if newly provided
      const updates: Record<string, any> = {};
      if (dto.accepted_terms === true && !existing.accepted_terms) updates.accepted_terms = true;
      if (dto.name?.trim() && !existing.name) updates.name = dto.name.trim();
      if (dto.email?.trim() && !existing.email) updates.email = dto.email.trim();
      if (Object.keys(updates).length) {
        const { error: updateUserErr } = await this.db.client.from('users').update(updates).eq('id', existing.id);
        if (updateUserErr) this.logger.error(`Failed to update user ${existing.id} on login: ${updateUserErr.message}`);
      }
    }

    // 24-hour access token. token_version (tv) in the DB allows instant
    // server-side revocation on logout — bumping tv invalidates all tokens.
    const access_token = this.jwt.sign(
      { sub: user.id, role: user.role, tv: user.token_version ?? 0 },
      { expiresIn: '24h' },
    );
    // Refresh token carries the user's token_version; bumping that column
    // (logout / revoke) invalidates every outstanding refresh token.
    const refresh_token = this.jwt.sign(
      { sub: user.id, role: user.role, tv: user.token_version ?? 0 },
      { secret: this.config.getOrThrow('JWT_REFRESH_SECRET'), expiresIn: '30d' },
    );

    return { access_token, refresh_token, user: { id: user.id, name: user.name, role: user.role } };
  }

  async refresh(token: string) {
    if (!token) throw new UnauthorizedException('No refresh token');
    let payload: any;
    try {
      payload = this.jwt.verify(token, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Revocation check: the token is only valid if its token_version still
    // matches the user's current one. logout()/revoke bumps it, invalidating
    // all previously issued refresh tokens (even though they haven't expired).
    const { data: user } = await this.db.client
      .from('users')
      .select('role, token_version')
      .eq('id', payload.sub)
      .maybeSingle();

    if (!user) throw new UnauthorizedException('User not found');
    if ((user.token_version ?? 0) !== (payload.tv ?? 0)) {
      // Version mismatch — user explicitly logged out from another device.
      throw new UnauthorizedException('Session revoked. Please log in again.');
    }

    // No version rotation on refresh — this prevents multi-tab sessions from
    // invalidating each other. The version is only bumped on explicit logout.
    const currentVersion = user.token_version ?? 0;

    // Use the fresh DB role so a role change (e.g. promotion to admin) takes
    // effect on the next refresh without forcing a full re-login.
    const access_token = this.jwt.sign(
      { sub: payload.sub, role: user.role, tv: currentVersion },
      { expiresIn: '24h' },
    );
    const refresh_token = this.jwt.sign(
      { sub: payload.sub, role: user.role, tv: currentVersion },
      { secret: this.config.getOrThrow('JWT_REFRESH_SECRET'), expiresIn: '30d' },
    );

    return { access_token, refresh_token };
  }

  /**
   * Revoke every outstanding refresh token for a user by bumping token_version.
   * Called on logout — after this, the cleared cookie's token would also fail
   * the version check even if it were replayed.
   */
  async revokeAllSessions(userId: string) {
    const { data: user } = await this.db.client
          .from('users').select('token_version').eq('id', userId).maybeSingle();
    const next = (user?.token_version ?? 0) + 1;
    const { error: tvErr } = await this.db.client
      .from('users').update({ token_version: next }).eq('id', userId);
    if (tvErr) this.logger.error(`Failed to bump token_version for user ${userId}: ${tvErr.message}`);
  }

  async logout(token?: string) {
    if (!token) return;
    try {
      const payload = this.jwt.verify(token, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
      await this.revokeAllSessions(payload.sub);
    } catch {
      // Invalid/expired token -- nothing to revoke.
    }
  }

  async getMe(userId: string) {
    const { data: user } = await this.db.client
      .from('users')
      .select('id, name, email, phone, role, created_at')
      .eq('id', userId)
      .single();
    return user;
  }
}
