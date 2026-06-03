import { Injectable, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
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
  ) {}

  async sendOtp(dto: SendOtpDto) {
    const identifier = dto.phone || dto.email;
    if (!identifier) throw new BadRequestException('Phone or email required');

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otp_hash = await bcrypt.hash(otp, 10);
    const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await this.db.client.from('otp_sessions').insert({ identifier, otp_hash, expires_at });

    // Send via email if email provided, otherwise log (SMS to be added later)
    if (dto.email) {
      await this.email.sendOtp(dto.email, otp);
    } else {
      // SMS not yet implemented. NEVER log the OTP value — that leaks a live
      // credential into Railway logs (anyone with log access could sign in).
      // Log only that delivery was attempted; wire up an SMS provider here.
      this.logger.warn(`Phone OTP requested for ${identifier} but SMS delivery is not configured`);
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
      await this.db.client.from('otp_sessions').update({ used: true }).eq('id', session.id);
      throw new UnauthorizedException('Too many attempts. Please request a new code.');
    }

    const valid = await bcrypt.compare(dto.otp, session.otp_hash);
    if (!valid) {
      const attempts = (session.attempts ?? 0) + 1;
      await this.db.client
        .from('otp_sessions')
        .update({ attempts, ...(attempts >= MAX_ATTEMPTS ? { used: true } : {}) })
        .eq('id', session.id);
      throw new UnauthorizedException(
        attempts >= MAX_ATTEMPTS ? 'Too many attempts. Please request a new code.' : 'Invalid OTP',
      );
    }

    await this.db.client
      .from('otp_sessions')
      .update({ used: true })
      .eq('id', session.id);

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
        .insert({ phone: dto.phone || null, email: dto.email || null })
        .select()
        .single();
      user = newUser;
    }

    const access_token = this.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: '15m' });
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
      throw new UnauthorizedException('Session revoked');
    }

    // Use the fresh DB role so a role change (e.g. promotion to admin) takes
    // effect on the next refresh without forcing a full re-login.
    const access_token = this.jwt.sign(
      { sub: payload.sub, role: user.role },
      { expiresIn: '15m' },
    );
    return { access_token };
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
    await this.db.client.from('users').update({ token_version: next }).eq('id', userId);
  }

  async logout(token?: string) {
    if (!token) return;
    try {
      const payload = this.jwt.verify(token, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
      await this.revokeAllSessions(payload.sub);
    } catch {
      // Invalid/expired token — nothing to revoke.
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
