import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * WhatsApp Business notifications via Meta Cloud API (official, free tier).
 *
 * Free tier: 1,000 conversations/month — no monthly fee.
 * Setup: https://developers.facebook.com → Create App → WhatsApp → get Phone Number ID + Access Token
 *
 * Required env vars (Railway):
 *   WHATSAPP_PHONE_NUMBER_ID  — e.g. 123456789012345
 *   WHATSAPP_ACCESS_TOKEN     — permanent system user token
 *
 * Template names below must match exactly what you register in Meta Business Manager.
 * Register these templates before going live:
 *   order_confirmation   — body vars: {{1}}=order#  {{2}}=total
 *   order_shipped        — body vars: {{1}}=order#  {{2}}=courier  {{3}}=tracking#
 *   order_delivered      — body vars: {{1}}=order#
 *   abandoned_cart       — body vars: {{1}}=name
 *   cod_order_confirmed  — body vars: {{1}}=order#  {{2}}=total
 *
 * All sends are fire-and-forget — never block the main request/response flow.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly phoneNumberId: string | undefined;
  private readonly accessToken: string | undefined;
  private readonly apiBase: string;

  constructor(private config: ConfigService) {
    this.phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    this.accessToken   = this.config.get<string>('WHATSAPP_ACCESS_TOKEN');
    this.apiBase       = `https://graph.facebook.com/v19.0`;
  }

  /** Returns true only if both required env vars are present. */
  get isConfigured(): boolean {
    return !!this.phoneNumberId && !!this.accessToken;
  }

  /**
   * Normalize a phone number to WhatsApp format: country code + digits, no +
   * Examples: "9876543210" → "919876543210"
   *           "+919876543210" → "919876543210"
   *           "919876543210" → "919876543210"
   */
  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) return digits;
    if (digits.length === 10) return `91${digits}`;
    // already has country code (11+ digits) or unknown format — pass through
    return digits;
  }

  /**
   * Format an integer-paise amount as a rupee string for message bodies.
   * Money is stored in paise everywhere, so 99900 → "₹999", 100050 → "₹1,000.50".
   */
  private inr(paise: number): string {
    return `₹${(Number(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }

  /**
   * Send a WhatsApp template message.
   * Returns silently on any error so callers never crash.
   */
  private async send(
    phone: string,
    templateName: string,
    bodyParams: string[],
  ): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn(
        `WhatsApp not configured — skipping ${templateName} to ${phone}. ` +
        'Add WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN to Railway env vars.',
      );
      return;
    }

    const to = this.normalizePhone(phone);
    if (!to || to.length < 10) {
      this.logger.warn(`WhatsApp: invalid phone "${phone}" — skipped ${templateName}`);
      return;
    }

    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en' },
        components: bodyParams.length
          ? [
              {
                type: 'body',
                parameters: bodyParams.map((text) => ({ type: 'text', text })),
              },
            ]
          : [],
      },
    };

    try {
      const res = await fetch(
        `${this.apiBase}/${this.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.accessToken}`,
          },
          body: JSON.stringify(body),
        },
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        this.logger.error(
          `WhatsApp send failed [${templateName} → ${to}]: HTTP ${res.status} — ${errText}`,
        );
      } else {
        this.logger.log(`WhatsApp sent [${templateName}] → ${to}`);
      }
    } catch (err: any) {
      this.logger.error(
        `WhatsApp send error [${templateName} → ${to}]: ${err?.message}`,
      );
    }
  }

  // ─── Public trigger methods ────────────────────────────────────────────────

  /**
   * Sent when an order is confirmed (COD at creation, Razorpay on payment).
   * Template: order_confirmation
   * Body vars: {{1}} order number, {{2}} total amount
   */
  sendOrderConfirmation(phone: string, orderNumber: string, total: number): void {
    this.send(phone, 'order_confirmation', [
      orderNumber,
      this.inr(total),
    ]).catch(() => {});
  }

  /**
   * Extra message for COD orders specifically.
   * Template: cod_order_confirmed
   * Body vars: {{1}} order number, {{2}} total amount
   */
  sendCodConfirmation(phone: string, orderNumber: string, total: number): void {
    this.send(phone, 'cod_order_confirmed', [
      orderNumber,
      this.inr(total),
    ]).catch(() => {});
  }

  /**
   * Sent when Shiprocket marks the order as shipped.
   * Template: order_shipped
   * Body vars: {{1}} order number, {{2}} courier name, {{3}} tracking/AWB
   */
  sendOrderShipped(
    phone: string,
    orderNumber: string,
    courierName: string,
    trackingNumber: string,
  ): void {
    this.send(phone, 'order_shipped', [
      orderNumber,
      courierName || 'our courier',
      trackingNumber || '—',
    ]).catch(() => {});
  }

  /**
   * Sent when Shiprocket marks the order as delivered.
   * Template: order_delivered
   * Body vars: {{1}} order number
   */
  sendOrderDelivered(phone: string, orderNumber: string): void {
    this.send(phone, 'order_delivered', [orderNumber]).catch(() => {});
  }

  /**
   * Sent to users with an abandoned cart (hourly cron).
   * Template: abandoned_cart
   * Body vars: {{1}} customer first name
   */
  sendAbandonedCart(phone: string, name: string): void {
    const firstName = (name || 'there').split(' ')[0];
    this.send(phone, 'abandoned_cart', [firstName]).catch(() => {});
  }

  /**
   * Reminder for an online (Razorpay) order whose payment is still pending.
   * Sent by the cron once, ~45 min after the order was created if still unpaid.
   * Template: payment_pending
   * Body vars: {{1}} order number, {{2}} total amount
   */
  sendPaymentPending(phone: string, orderNumber: string, total: number): void {
    this.send(phone, 'payment_pending', [
      orderNumber,
      this.inr(total),
    ]).catch(() => {});
  }

  /**
   * Marketing broadcast announcing a new product / collection launch.
   * NOTE: this is a Meta MARKETING-category template — it may only be sent to
   * customers who have opted in to marketing, and Meta charges per marketing
   * conversation. Register it separately from the transactional templates.
   * Template: new_launch
   * Body vars: {{1}} product / collection name
   */
  sendNewLaunch(phone: string, launchName: string): void {
    this.send(phone, 'new_launch', [launchName]).catch(() => {});
  }
}
