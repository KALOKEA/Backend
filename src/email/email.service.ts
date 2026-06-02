import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey: string;
  private readonly senderEmail: string;
  private readonly senderName: string;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get('BREVO_API_KEY') || '';
    this.senderEmail = this.config.get('BREVO_SENDER_EMAIL') || 'noreply@kalokea.in';
    this.senderName = this.config.get('BREVO_SENDER_NAME') || 'Kalokea';
  }

  // All money is stored in paise; format to ₹ for display in emails.
  private money(paise: number): string {
    return `₹${(Math.round(paise) / 100).toLocaleString('en-IN')}`;
  }

  /**
   * Branded, email-client-safe shell (table layout + inline styles so it renders
   * consistently in Gmail/Outlook). Brand: black header, rose accent (#c8a4a5),
   * cream surfaces. `preheader` is the hidden inbox-preview snippet.
   */
  private layout(opts: { preheader?: string; eyebrow?: string; heading: string; body: string; footerNote?: string }): string {
    const year = new Date().getFullYear();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
</head>
<body style="margin:0;padding:0;background:#f4f2ef;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preheader || ''}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ef;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e8e4e0;border-radius:8px;overflow:hidden;">
        <tr><td style="background:#0a0a0a;padding:26px 32px;text-align:center;">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:24px;letter-spacing:7px;color:#ffffff;">KALOKEA</span>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#c8a4a5;margin-top:4px;">Women&rsquo;s Fashion</div>
        </td></tr>
        <tr><td style="padding:38px 32px 34px;font-family:Arial,Helvetica,sans-serif;color:#0a0a0a;">
          ${opts.eyebrow ? `<p style="margin:0 0 10px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#c8a4a5;">${opts.eyebrow}</p>` : ''}
          <h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:normal;line-height:1.3;color:#0a0a0a;">${opts.heading}</h1>
          ${opts.body}
        </td></tr>
        <tr><td style="background:#faf8f5;border-top:1px solid #e8e4e0;padding:22px 32px;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#9a9a9a;">
          ${opts.footerNote ? `<p style="margin:0 0 8px;">${opts.footerNote}</p>` : ''}
          <p style="margin:0;">&copy; ${year} KALOKEA &middot; Made in India</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn(`Email not sent (no BREVO_API_KEY). To: ${to} | Subject: ${subject}`);
      return;
    }
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': this.apiKey,
        },
        body: JSON.stringify({
          sender: { email: this.senderEmail, name: this.senderName },
          to: [{ email: to }],
          subject,
          htmlContent: html,
        }),
      });
      if (!response.ok) {
        const err = await response.text();
        this.logger.error(`Brevo error: ${err}`);
      }
    } catch (err) {
      this.logger.error('Email send failed:', err);
    }
  }

  async sendOtp(to: string, otp: string): Promise<void> {
    const body = `
      <p style="margin:0 0 26px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Use the verification code below to sign in to your Kalokea account.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 26px;">
        <tr><td align="center" style="background:#faf8f5;border:1px solid #e8e4e0;border-radius:8px;padding:22px 0;">
          <span style="font-family:Georgia,'Times New Roman',serif;font-size:38px;font-weight:bold;letter-spacing:14px;color:#0a0a0a;padding-left:14px;">${otp}</span>
        </td></tr>
      </table>
      <p style="margin:0;font-size:13px;line-height:1.7;color:#6b6b6b;">
        This code expires in <strong style="color:#0a0a0a;">5 minutes</strong>. For your security, never share it with anyone &mdash; Kalokea will never ask you for it.
      </p>
    `;
    const html = this.layout({
      preheader: `Your Kalokea login code is ${otp}`,
      eyebrow: 'Secure Login',
      heading: 'Your login code',
      body,
      footerNote: "If you didn't request this code, you can safely ignore this email.",
    });
    await this.send(to, `${otp} is your Kalokea login code`, html);
  }

  async sendOrderConfirmation(to: string, vars: {
    customer_name: string;
    order_id: string;
    total: number; // paise
    items: Array<{ name: string; quantity: number; price: number }>; // price = line unit price in paise
  }): Promise<void> {
    const rows = (vars.items || [])
      .map(
        (it) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #f0ece8;font-size:14px;color:#0a0a0a;">${it.name} <span style="color:#9a9a9a;">&times; ${it.quantity}</span></td>
          <td style="padding:10px 0;border-bottom:1px solid #f0ece8;font-size:14px;color:#0a0a0a;text-align:right;white-space:nowrap;">${this.money(it.price * it.quantity)}</td>
        </tr>`,
      )
      .join('');

    const body = `
      <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Hi ${vars.customer_name}, thank you for your order. We&rsquo;ve received it and will let you know as soon as it ships.
      </p>
      <p style="margin:0 0 10px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#9a9a9a;">Order #${vars.order_id}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td style="padding:14px 0 0;font-size:15px;font-weight:bold;color:#0a0a0a;">Total</td>
            <td style="padding:14px 0 0;font-size:15px;font-weight:bold;color:#0a0a0a;text-align:right;">${this.money(vars.total)}</td>
          </tr>
        </tfoot>
      </table>
    `;
    const html = this.layout({
      preheader: `Order #${vars.order_id} confirmed — ${this.money(vars.total)}`,
      eyebrow: 'Order Confirmed',
      heading: 'Thank you for your order',
      body,
      footerNote: 'Questions about your order? Just reply to this email.',
    });
    await this.send(to, `Order confirmed — #${vars.order_id}`, html);
  }

  async sendOrderShipped(to: string, vars: {
    customer_name: string;
    order_id: string;
    tracking_number: string;
    courier_name: string;
  }): Promise<void> {
    const body = `
      <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Good news, ${vars.customer_name} &mdash; your order <strong style="color:#0a0a0a;">#${vars.order_id}</strong> is on its way.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;border:1px solid #e8e4e0;border-radius:8px;">
        <tr><td style="padding:16px 20px;font-size:13px;color:#6b6b6b;">
          <span style="display:inline-block;width:90px;color:#9a9a9a;text-transform:uppercase;font-size:10px;letter-spacing:1px;">Courier</span>
          <strong style="color:#0a0a0a;">${vars.courier_name}</strong>
        </td></tr>
        <tr><td style="padding:0 20px 16px;font-size:13px;color:#6b6b6b;">
          <span style="display:inline-block;width:90px;color:#9a9a9a;text-transform:uppercase;font-size:10px;letter-spacing:1px;">Tracking</span>
          <strong style="color:#0a0a0a;">${vars.tracking_number}</strong>
        </td></tr>
      </table>
    `;
    const html = this.layout({
      preheader: `Your Kalokea order #${vars.order_id} has shipped`,
      eyebrow: 'On its way',
      heading: 'Your order has shipped',
      body,
      footerNote: 'Delivery usually takes 3&ndash;5 business days.',
    });
    await this.send(to, `Shipped — #${vars.order_id}`, html);
  }

  async sendAdminNewOrder(vars: {
    order_id: string;
    customer_name: string;
    total: number;
    items_count: number;
    payment_method: string;
  }): Promise<void> {
    const adminEmail = this.config.get('ADMIN_EMAIL');
    if (!adminEmail) return;
    const html = `
      <div style="font-family:sans-serif">
        <h2>New Order #${vars.order_id}</h2>
        <p>Customer: ${vars.customer_name}</p>
        <p>Items: ${vars.items_count} | Payment: ${vars.payment_method}</p>
        <p><strong>Total: ${this.money(vars.total)}</strong></p>
      </div>
    `;
    await this.send(adminEmail, `New Order — ${this.money(vars.total)}`, html);
  }

  async sendNewsletterWelcome(to: string): Promise<void> {
    const body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Welcome to the Kalokea family. You&rsquo;ll be first to hear about new arrivals,
        exclusive offers, and style inspiration &mdash; straight to your inbox.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 0;">
        <tr><td style="border-radius:6px;background:#0a0a0a;">
          <a href="https://kalokea.pages.dev/shop" style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;">Shop New Arrivals</a>
        </td></tr>
      </table>
    `;
    const html = this.layout({
      preheader: 'Welcome to Kalokea — new arrivals, offers & style inspiration.',
      eyebrow: 'Welcome',
      heading: 'You&rsquo;re on the list',
      body,
      footerNote: 'You can unsubscribe at any time.',
    });
    await this.send(to, 'Welcome to Kalokea', html);
  }

  async sendLowStockAlert(vars: {
    product_name: string;
    variant: string;
    current_stock: number;
  }): Promise<void> {
    const adminEmail = this.config.get('ADMIN_EMAIL');
    if (!adminEmail) return;
    const html = `
      <p>Low stock alert: <strong>${vars.product_name}</strong> (${vars.variant}) — only ${vars.current_stock} left.</p>
    `;
    await this.send(adminEmail, `Low Stock: ${vars.product_name}`, html);
  }
}
