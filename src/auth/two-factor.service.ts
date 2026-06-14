import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class TwoFactorService {
  constructor(private db: DatabaseService) {}

  /** Generate a new TOTP secret + QR code for the user. Does NOT enable 2FA yet. */
  async setup(userId: string, email: string): Promise<{ qr_code: string; secret: string }> {
    const secret = speakeasy.generateSecret({
      name: `KALOKEA Admin (${email})`,
      issuer: 'KALOKEA',
      length: 20,
    });

    // Store secret (not yet enabled)
    const { error } = await this.db.client
      .from('users')
      .update({ totp_secret: secret.base32 })
      .eq('id', userId);
    if (error) throw new BadRequestException('Failed to save 2FA secret');

    // Generate QR code as data URL
    const qr = await QRCode.toDataURL(secret.otpauth_url || '');

    return { qr_code: qr, secret: secret.base32 };
  }

  /** Verify a TOTP token and enable 2FA if valid. */
  async enable(userId: string, token: string): Promise<void> {
    const { data: user } = await this.db.client
      .from('users')
      .select('totp_secret')
      .eq('id', userId)
      .single();

    if (!user?.totp_secret) throw new BadRequestException('Run 2FA setup first');

    const valid = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token,
      window: 1,
    });
    if (!valid) throw new BadRequestException('Invalid code — please try again');

    await this.db.client
      .from('users')
      .update({ totp_enabled: true })
      .eq('id', userId);
  }

  /** Verify a TOTP token (login step — does not change DB). */
  async verify(userId: string, token: string): Promise<void> {
    const { data: user } = await this.db.client
      .from('users')
      .select('totp_secret, totp_enabled')
      .eq('id', userId)
      .single();

    if (!user?.totp_enabled || !user?.totp_secret) {
      throw new BadRequestException('2FA is not enabled for this account');
    }

    const valid = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token,
      window: 1,
    });
    if (!valid) throw new UnauthorizedException('Invalid 2FA code');
  }

  /** Disable 2FA on the account. */
  async disable(userId: string, token: string): Promise<void> {
    // Require a valid TOTP code to disable (prevents lockout attacks)
    await this.verify(userId, token);
    await this.db.client
      .from('users')
      .update({ totp_enabled: false, totp_secret: null })
      .eq('id', userId);
  }

  /** Get 2FA status for the user. */
  async getStatus(userId: string): Promise<{ enabled: boolean }> {
    const { data: user } = await this.db.client
      .from('users')
      .select('totp_enabled')
      .eq('id', userId)
      .single();
    return { enabled: Boolean(user?.totp_enabled) };
  }
}
