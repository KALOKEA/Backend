import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly apiKey: string;
  private readonly senderEmail: string;
  private readonly senderName: string;

  constructor(
    private config: ConfigService,
    private db: DatabaseService,
  ) {
    this.apiKey = this.config.get('BREVO_API_KEY') || '';
    this.senderEmail = this.config.get('BREVO_SENDER_EMAIL') || 'noreply@kalokea.in';
    this.senderName = this.config.get('BREVO_SENDER_NAME') || 'Kalokea';
  }

  /** Append a row to email_log (fire-and-forget — never throws). */
  private async logEmail(
    recipient: string,
    subject: string,
    emailType: string,
    status: 'sent' | 'failed' | 'retried_ok' | 'retried_fail',
    errorMessage?: string,
    retryCount = 0,
  ): Promise<void> {
    try {
      await this.db.client.from('email_log').insert({
        recipient,
        subject,
        email_type: emailType,
        status,
        error_message: errorMessage ?? null,
        retry_count: retryCount,
      });
    } catch (e) {
      this.logger.warn('Failed to write email_log entry:', e);
    }
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

  private async sendToBrevo(
    to: string,
    subject: string,
    html: string,
    attachments?: Array<{ name: string; content: string }>,
  ): Promise<void> {
    const payload: any = {
      sender: { email: this.senderEmail, name: this.senderName },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    };
    if (attachments?.length) payload.attachment = attachments;
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': this.apiKey },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Brevo API error: ${err}`);
    }
  }

  private async send(
    to: string,
    subject: string,
    html: string,
    attachments?: Array<{ name: string; content: string }>, // content = base64
    emailType = 'unknown',
  ): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn(`Email not sent (no BREVO_API_KEY). To: ${to} | Subject: ${subject}`);
      await this.logEmail(to, subject, emailType, 'failed', 'BREVO_API_KEY not configured');
      return;
    }
    try {
      await this.sendToBrevo(to, subject, html, attachments);
      await this.logEmail(to, subject, emailType, 'sent');
    } catch (err: any) {
      this.logger.error(`Email send failed (attempt 1): ${err?.message}`);
      // Retry once after 5 seconds
      await new Promise(r => setTimeout(r, 5000));
      try {
        await this.sendToBrevo(to, subject, html, attachments);
        this.logger.log(`Email send succeeded on retry. To: ${to} | Subject: ${subject}`);
        await this.logEmail(to, subject, emailType, 'retried_ok', err?.message, 1);
      } catch (retryErr: any) {
        this.logger.error(`Email send failed (attempt 2, permanent): ${retryErr?.message}`);
        await this.logEmail(to, subject, emailType, 'retried_fail', retryErr?.message, 1);
      }
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
    await this.send(to, `${otp} is your Kalokea login code`, html, undefined, 'otp');
  }

  async sendOrderConfirmation(to: string, vars: {
    customer_name: string;
    order_id: string;       // order_number (e.g. KLK-xxx) — shown in email
    order_db_id?: string;   // UUID — used for track/invoice links
    total: number; // paise
    items: Array<{ name: string; quantity: number; price: number }>; // price = line unit price in paise
    address?: {
      name?: string; line1?: string; line2?: string;
      city?: string; state?: string; pincode?: string;
    };
    // Optional GST receipt breakdown (all paise). When present, a full payment
    // receipt is shown and the tax invoice is attached.
    receipt?: {
      subtotal: number;
      discount?: number;
      taxable_value: number;
      cgst: number;
      sgst: number;
      igst: number;
      total_gst: number;
      shipping: number;
      is_intra_state: boolean;
      payment_method?: string;
    };
    invoice_html?: string; // attached as the tax invoice
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

    // Payment receipt block (taxable value, GST split, shipping, paid total).
    const r = vars.receipt;
    const line = (label: string, value: string, strong = false) => `
      <tr>
        <td style="padding:5px 0;font-size:13px;color:${strong ? '#0a0a0a' : '#6b6b6b'};${strong ? 'font-weight:bold;' : ''}">${label}</td>
        <td style="padding:5px 0;font-size:13px;text-align:right;color:${strong ? '#0a0a0a' : '#6b6b6b'};${strong ? 'font-weight:bold;' : ''}">${value}</td>
      </tr>`;
    const receiptBlock = r
      ? `
      <p style="margin:22px 0 8px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#9a9a9a;">Payment receipt</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;border:1px solid #e8e4e0;border-radius:8px;padding:8px 16px;margin:0 0 4px;">
        ${line('Taxable value', this.money(r.taxable_value))}
        ${r.discount ? line('Discount', `- ${this.money(r.discount)}`) : ''}
        ${r.is_intra_state
          ? line('CGST', this.money(r.cgst)) + line('SGST', this.money(r.sgst))
          : line('IGST', this.money(r.igst))}
        ${line('Shipping', r.shipping ? this.money(r.shipping) : 'Free')}
        ${line('Total paid', this.money(vars.total), true)}
      </table>
      ${r.payment_method ? `<p style="margin:6px 0 0;font-size:12px;color:#9a9a9a;">Payment method: ${r.payment_method}</p>` : ''}
      `
      : '';

    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.pages.dev';
    const backendUrl = this.config.get('BACKEND_URL') || 'https://api.kalokea.in';
    const trackLink = vars.order_db_id
      ? `${siteUrl}/account/orders`
      : `${siteUrl}/account/orders`;
    const invoiceLink = vars.order_db_id
      ? `${backendUrl}/orders/${vars.order_db_id}/invoice`
      : null;

    const addr = vars.address;
    const addressBlock = addr && (addr.line1 || addr.city)
      ? `
      <p style="margin:22px 0 6px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#9a9a9a;">Delivering to</p>
      <p style="margin:0;font-size:13px;color:#6b6b6b;line-height:1.7;">
        ${addr.name ? `<strong style="color:#0a0a0a;">${addr.name}</strong><br>` : ''}
        ${addr.line1 || ''}${addr.line2 ? ', ' + addr.line2 : ''}<br>
        ${[addr.city, addr.state].filter(Boolean).join(', ')}${addr.pincode ? ' - ' + addr.pincode : ''}
      </p>
      <p style="margin:10px 0 0;font-size:13px;color:#6b6b6b;">
        Estimated delivery: <strong style="color:#0a0a0a;">3&ndash;5 business days</strong>
      </p>`
      : `<p style="margin:22px 0 0;font-size:13px;color:#6b6b6b;">
        Estimated delivery: <strong style="color:#0a0a0a;">3&ndash;5 business days</strong>
      </p>`;

    const body = `
      <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Hi ${vars.customer_name}, thank you for your order. Your booking is confirmed &mdash; we&rsquo;ll let you know as soon as it ships.${vars.invoice_html ? ' Your GST tax invoice is attached to this email.' : ''}
      </p>
      <p style="margin:0 0 10px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#9a9a9a;">Order #${vars.order_id}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
        <tbody>${rows}</tbody>
      </table>
      ${receiptBlock}
      ${addressBlock}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
        <tr>
          <td style="padding-right:10px;">
            <a href="${trackLink}"
               style="display:inline-block;padding:11px 22px;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;border-radius:4px;">
              Track Your Order
            </a>
          </td>
          ${invoiceLink ? `<td>
            <a href="${invoiceLink}"
               style="display:inline-block;padding:11px 22px;background:#faf8f5;border:1px solid #e8e4e0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#0a0a0a;text-decoration:none;border-radius:4px;">
              View Invoice
            </a>
          </td>` : ''}
        </tr>
      </table>
    `;
    const html = this.layout({
      preheader: `Order #${vars.order_id} confirmed — ${this.money(vars.total)}`,
      eyebrow: 'Order Confirmed',
      heading: 'Thank you for your order',
      body,
      footerNote: 'Questions about your order? Just reply to this email.',
    });

    const attachments = vars.invoice_html
      ? [{ name: `Invoice-${vars.order_id}.html`, content: Buffer.from(vars.invoice_html, 'utf-8').toString('base64') }]
      : undefined;

    await this.send(to, `Order confirmed — #${vars.order_id}`, html, attachments, 'order_confirmation');
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
    await this.send(to, `Shipped — #${vars.order_id}`, html, undefined, 'order_shipped');
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
    await this.send(adminEmail, `New Order — ${this.money(vars.total)}`, html, undefined, 'admin_new_order');
  }

  async sendRefundProcessed(to: string, vars: {
    customer_name: string;
    order_id: string;
    refund_amount: number; // paise
    method: string; // 'Razorpay' | 'Manual (COD)'
    refund_days?: string;
  }): Promise<void> {
    const body = `
      <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Hi ${vars.customer_name}, your refund for order <strong style="color:#0a0a0a;">#${vars.order_id}</strong> has been processed.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;border:1px solid #e8e4e0;border-radius:8px;">
        <tr><td style="padding:16px 20px;font-size:13px;color:#6b6b6b;">
          <span style="display:inline-block;width:120px;color:#9a9a9a;text-transform:uppercase;font-size:10px;letter-spacing:1px;">Refund amount</span>
          <strong style="color:#0a0a0a;">${this.money(vars.refund_amount)}</strong>
        </td></tr>
        <tr><td style="padding:0 20px 16px;font-size:13px;color:#6b6b6b;">
          <span style="display:inline-block;width:120px;color:#9a9a9a;text-transform:uppercase;font-size:10px;letter-spacing:1px;">Method</span>
          <strong style="color:#0a0a0a;">${vars.method}</strong>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:13px;line-height:1.7;color:#6b6b6b;">
        ${vars.method === 'Razorpay'
          ? `It should reflect in your account within ${vars.refund_days || '5–7 business days'}.`
          : 'Our team will reach out to arrange the refund.'}
      </p>
    `;
    const html = this.layout({
      preheader: `Refund of ${this.money(vars.refund_amount)} for order #${vars.order_id}`,
      eyebrow: 'Refund Processed',
      heading: 'Your refund is on its way',
      body,
      footerNote: 'Questions? Just reply to this email.',
    });
    await this.send(to, `Refund processed — #${vars.order_id}`, html, undefined, 'refund');
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
    await this.send(to, 'Welcome to Kalokea', html, undefined, 'newsletter_welcome');
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
    await this.send(adminEmail, `Low Stock: ${vars.product_name}`, html, undefined, 'low_stock_alert');
  }

  // ── Payment failed ─────────────────────────────────────────────────────────

  async sendPaymentFailed(to: string, vars: {
    customer_name: string;
    order_id: string;
    amount: number; // paise
  }): Promise<void> {
    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.pages.dev';
    const body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Hi ${vars.customer_name}, unfortunately your payment of
        <strong style="color:#0a0a0a;">${this.money(vars.amount)}</strong>
        for order <strong style="color:#0a0a0a;">#${vars.order_id}</strong> could not be processed.
      </p>
      <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Your cart is saved. Click below to try again with a different payment method.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr><td style="border-radius:6px;background:#0a0a0a;">
          <a href="${siteUrl}/cart"
             style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
            Retry Payment
          </a>
        </td></tr>
      </table>
    `;
    const html = this.layout({
      preheader: `Payment failed for order #${vars.order_id} — please retry`,
      eyebrow: 'Action Required',
      heading: 'Your payment didn’t go through',
      body,
      footerNote: 'If this keeps happening, contact us at support@kalokea.in.',
    });
    await this.send(to, `Payment failed — Order #${vars.order_id}`, html, undefined, 'payment_failed');
  }

  // ── Order delivered (with review CTA) ──────────────────────────────────────

  async sendOrderDelivered(to: string, vars: {
    customer_name: string;
    order_id: string;
    order_db_id: string; // UUID for the review link
  }): Promise<void> {
    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.pages.dev';
    const body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Hi ${vars.customer_name}, your order <strong style="color:#0a0a0a;">#${vars.order_id}</strong>
        has been delivered. We hope you love it!
      </p>
      <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        A quick review helps other shoppers and means the world to us. It only takes a minute.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="border-radius:6px;background:#0a0a0a;">
          <a href="${siteUrl}/account/orders"
             style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
            Write a Review
          </a>
        </td></tr>
      </table>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#9a9a9a;">
        If you have any issues with your order, you can request a return from the same page within 7 days.
      </p>
    `;
    const html = this.layout({
      preheader: `Your Kalokea order #${vars.order_id} is delivered — share your thoughts!`,
      eyebrow: 'Delivered',
      heading: 'Your order has arrived',
      body,
    });
    await this.send(to, `Delivered — #${vars.order_id}`, html, undefined, 'order_delivered');
  }

  // ── Review approved ────────────────────────────────────────────────────────

  async sendReviewApproved(to: string, vars: {
    customer_name: string;
    product_name: string;
    product_slug: string;
  }): Promise<void> {
    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.pages.dev';
    const body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Hi ${vars.customer_name}, your review for
        <strong style="color:#0a0a0a;">${vars.product_name}</strong>
        has been approved and is now live on the product page.
      </p>
      <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Thank you for sharing your experience — it genuinely helps other shoppers.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr><td style="border-radius:6px;background:#0a0a0a;">
          <a href="${siteUrl}/product/${vars.product_slug}"
             style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
            View Product
          </a>
        </td></tr>
      </table>
    `;
    const html = this.layout({
      preheader: `Your review of ${vars.product_name} is now live on Kalokea`,
      eyebrow: 'Review Published',
      heading: 'Your review is live!',
      body,
    });
    await this.send(to, `Your review is live — ${vars.product_name}`, html, undefined, 'review_approved');
  }

  // ── Return approved ────────────────────────────────────────────────────────

  async sendReturnApproved(to: string, vars: {
    customer_name: string;
    order_id: string;
    instructions?: string;
  }): Promise<void> {
    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.pages.dev';
    const body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Hi ${vars.customer_name}, your return request for order
        <strong style="color:#0a0a0a;">#${vars.order_id}</strong> has been approved.
      </p>
      ${vars.instructions ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#faf8f5;border:1px solid #e8e4e0;border-radius:8px;margin-bottom:22px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 6px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#9a9a9a;">
            Return instructions
          </p>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#0a0a0a;">${vars.instructions}</p>
        </td></tr>
      </table>` : `
      <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Our team will be in touch shortly with pickup or drop-off instructions.
      </p>`}
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr><td style="border-radius:6px;background:#0a0a0a;">
          <a href="${siteUrl}/account/orders"
             style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
            View My Orders
          </a>
        </td></tr>
      </table>
    `;
    const html = this.layout({
      preheader: `Return approved for order #${vars.order_id}`,
      eyebrow: 'Return Approved',
      heading: 'Your return has been approved',
      body,
      footerNote: 'Once we receive the item, your refund will be processed within 5&ndash;7 business days.',
    });
    await this.send(to, `Return approved — #${vars.order_id}`, html, undefined, 'return_approved');
  }

  // ── Order cancelled ────────────────────────────────────────────────────────

  async sendOrderCancellation(to: string, vars: {
    customer_name: string;
    order_id: string;
    total: number; // paise
  }): Promise<void> {
    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.pages.dev';
    const body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Hi ${vars.customer_name}, your order <strong style="color:#0a0a0a;">#${vars.order_id}</strong>
        (${this.money(vars.total)}) has been successfully cancelled.
      </p>
      <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        If you paid online, your refund will be processed within 5&ndash;7 business days to your original payment method.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="border-radius:6px;background:#0a0a0a;">
          <a href="${siteUrl}/shop"
             style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
            Continue Shopping
          </a>
        </td></tr>
      </table>
        If you didn&rsquo;t request this cancellation, please contact us at support@kalokea.in.
      </p>
    `;
    const html = this.layout({
      preheader: `Your order #${vars.order_id} has been cancelled`,
      eyebrow: 'Order Update',
      heading: 'Order cancelled',
      body,
    });
    await this.send(to, `Order cancelled — #${vars.order_id}`, html, undefined, 'order_cancelled');
  }

  // ── Contact form forward ───────────────────────────────────────────────────

  async sendContactForm(vars: {
    name: string;
    email: string;
    message: string;
  }): Promise<void> {
    const adminEmail = this.config.get<string>('ADMIN_EMAIL');
    if (!adminEmail) return;
    const body = `
      <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        A new message has been submitted via the contact form.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 22px;border:1px solid #e8e4e0;border-radius:6px;overflow:hidden;">
        <tr><td style="padding:12px 16px;background:#faf8f5;border-bottom:1px solid #e8e4e0;">
          <span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6b6b;">From</span>
        </td><td style="padding:12px 16px;background:#faf8f5;border-bottom:1px solid #e8e4e0;text-align:right;">
          <strong style="color:#0a0a0a;">${vars.name}</strong> &lt;${vars.email}&gt;
        </td></tr>
        <tr><td colspan="2" style="padding:16px;">
          <span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6b6b;">Message</span>
          <p style="margin:8px 0 0;font-size:14px;line-height:1.7;color:#0a0a0a;white-space:pre-wrap;">${vars.message}</p>
        </td></tr>
      </table>
      <p style="margin:0;font-size:13px;color:#6b6b6b;">Reply directly to this email to respond to the customer.</p>
    `;
    const html = this.layout({
      preheader: `Contact form: ${vars.name}`,
      eyebrow: 'Customer Message',
      heading: 'New contact form submission',
      body,
    });
    await this.send(adminEmail, `Contact: ${vars.name} <${vars.email}>`, html, undefined, 'contact_form');
  }

  // ── Admin: return filed alert ──────────────────────────────────────────────

  async sendAdminReturnFiled(vars: {
    customer_name: string;
    customer_email: string;
    order_id: string;
    reason?: string;
  }): Promise<void> {
    const adminEmail = this.config.get<string>('ADMIN_EMAIL');
    if (!adminEmail) return;
    const body = `
      <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        A new return request has been filed.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 22px;border:1px solid #e8e4e0;border-radius:6px;overflow:hidden;">
        <tr><td style="padding:12px 16px;background:#faf8f5;border-bottom:1px solid #e8e4e0;">
          <span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6b6b;">Order</span>
        </td><td style="padding:12px 16px;background:#faf8f5;border-bottom:1px solid #e8e4e0;text-align:right;">
          <strong style="color:#0a0a0a;">#${vars.order_id}</strong>
        </td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #e8e4e0;">
          <span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6b6b;">Customer</span>
        </td><td style="padding:12px 16px;border-bottom:1px solid #e8e4e0;text-align:right;">
          ${vars.customer_name} &lt;${vars.customer_email}&gt;
        </td></tr>
        ${vars.reason ? `<tr><td style="padding:12px 16px;" colspan="2">
          <span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6b6b;">Reason</span><br>
          <span style="font-size:14px;color:#0a0a0a;margin-top:4px;display:block;">${vars.reason}</span>
        </td></tr>` : ''}
      </table>
      <p style="margin:0;font-size:13px;color:#6b6b6b;">Log in to the admin panel to review and approve or reject this return.</p>
    `;
    const html = this.layout({
      preheader: `Return filed for order #${vars.order_id}`,
      eyebrow: 'Returns & Refunds',
      heading: 'New return request',
      body,
    });
    await this.send(adminEmail, `Return filed — #${vars.order_id}`, html, undefined, 'admin_return_filed');
  }
}
