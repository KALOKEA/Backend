import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Provider-agnostic SMS service.
 *
 * Set one of the following pairs in Railway env vars to activate:
 *
 *   MSG91 (recommended for India):
 *     SMS_PROVIDER=msg91
 *     SMS_API_KEY=<your-authkey>          (from msg91.com → API → Authkey)
 *     SMS_SENDER_ID=KALOKEA               (6-char sender ID, pre-registered)
 *     SMS_TEMPLATE_ID=<dlt-template-id>   (DLT-approved OTP template ID)
 *
 *   2Factor.in (simpler, no DLT setup):
 *     SMS_PROVIDER=2factor
 *     SMS_API_KEY=<your-api-key>          (from 2factor.in dashboard)
 *
 *   Generic HTTP (any provider with a single GET/POST endpoint):
 *     SMS_PROVIDER=generic
 *     SMS_API_URL=https://api.provider.com/send?key=KEY&to={to}&msg={msg}
 *       ({to} and {msg} are substituted at send time)
 *
 * If SMS_PROVIDER is not set, OTP is NOT sent and a warning is logged.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private config: ConfigService) {}

  async sendOtp(phone: string, otp: string): Promise<void> {
    const provider = (this.config.get<string>('SMS_PROVIDER') || '').toLowerCase();
    const apiKey = this.config.get<string>('SMS_API_KEY') || '';

    if (!provider || !apiKey) {
      this.logger.warn(
        `SMS OTP not sent to ${phone} — set SMS_PROVIDER and SMS_API_KEY in Railway. ` +
        `Supported: msg91, 2factor, generic.`,
      );
      return;
    }

    try {
      if (provider === 'msg91') {
        await this.sendMsg91(phone, otp, apiKey);
      } else if (provider === '2factor') {
        await this.send2Factor(phone, otp, apiKey);
      } else if (provider === 'generic') {
        await this.sendGeneric(phone, otp);
      } else {
        this.logger.warn(`Unknown SMS_PROVIDER "${provider}". Supported: msg91, 2factor, generic.`);
      }
    } catch (err: any) {
      // Never throw — a broken SMS provider must not break the auth flow.
      // Log the error so it appears in Railway logs for debugging.
      this.logger.error(`SMS send failed to ${phone}: ${err?.message || err}`);
    }
  }

  // ── MSG91 ──────────────────────────────────────────────────────────────────

  private async sendMsg91(phone: string, otp: string, authKey: string): Promise<void> {
    const senderId = this.config.get<string>('SMS_SENDER_ID') || 'KALOKEA';
    const templateId = this.config.get<string>('SMS_TEMPLATE_ID') || '';

    // Normalise: strip leading + or 0, ensure 91 country prefix
    const normalised = this.normaliseIndianPhone(phone);

    const payload = {
      flow_id: templateId,
      sender: senderId,
      mobiles: normalised,
      OTP: otp,                // MSG91 OTP flow expects {{OTP}} variable
    };

    const res = await fetch('https://api.msg91.com/api/v5/otp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authkey: authKey,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({})) as any;
    if (!res.ok || json.type === 'error') {
      throw new Error(`MSG91 error: ${json.message || res.status}`);
    }
    this.logger.log(`MSG91 OTP sent to ${normalised}`);
  }

  // ── 2Factor.in ─────────────────────────────────────────────────────────────

  private async send2Factor(phone: string, otp: string, apiKey: string): Promise<void> {
    const normalised = this.normaliseIndianPhone(phone);

    const url =
      `https://2factor.in/API/V1/${apiKey}/SMS/${normalised}/${otp}/AUTOGEN2`;

    const res = await fetch(url);
    const json = await res.json().catch(() => ({})) as any;
    if (json.Status !== 'Success') {
      throw new Error(`2Factor error: ${json.Details || res.status}`);
    }
    this.logger.log(`2Factor OTP sent to ${normalised}`);
  }

  // ── Generic HTTP provider ──────────────────────────────────────────────────

  private async sendGeneric(phone: string, otp: string): Promise<void> {
    const template = this.config.get<string>('SMS_API_URL') || '';
    if (!template) {
      this.logger.warn('SMS_PROVIDER=generic but SMS_API_URL is not set.');
      return;
    }
    const url = template
      .replace('{to}', encodeURIComponent(phone))
      .replace('{msg}', encodeURIComponent(`Your Kalokea OTP is ${otp}. Valid for 5 minutes. Do not share.`));

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Generic SMS HTTP ${res.status}`);
    this.logger.log(`Generic SMS OTP sent to ${phone}`);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Normalise Indian phone number to 91XXXXXXXXXX format. */
  private normaliseIndianPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('91') && digits.length === 12) return digits;
    if (digits.length === 10) return `91${digits}`;
    return digits; // pass through if already formatted or international
  }
}
