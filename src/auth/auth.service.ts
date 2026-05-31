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
      // SMS not yet implemented — log OTP for now
      this.logger.log(`OTP for ${identifier}: ${otp}`);
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
    const valid = await bcrypt.compare(dto.otp, session.otp_hash);
    if (!valid) throw new UnauthorizedException('Invalid OTP');

    await this.db.client
      .from('otp_sessions')
      .update({ used: true })
      .eq('id', session.id);

    let { data: user } = await this.db.client
      .from('users')
      .select('*')
      .or(dto.phone ? `phone.eq.${dto.phone}` : `email.eq.${dto.email}`)
      .single();

    if (!user) {
      const { data: newUser } = await this.db.client
        .from('users')
        .insert({ phone: dto.phone || null, email: dto.email || null })
        .select()
        .single();
      user = newUser;
    }

    const payload = { sub: user.id, role: user.role };
    const access_token = this.jwt.sign(payload, { expiresIn: '15m' });
    const refresh_token = this.jwt.sign(payload, {
      secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      expiresIn: '30d',
    });

    return { access_token, refresh_token, user: { id: user.id, name: user.name, role: user.role } };
  }

  async refresh(token: string) {
    if (!token) throw new UnauthorizedException('No refresh token');
    try {
      const payload = this.jwt.verify(token, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
      const access_token = this.jwt.sign(
        { sub: payload.sub, role: payload.role },
        { expiresIn: '15m' },
      );
      return { access_token };
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
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
