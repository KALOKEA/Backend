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

  /**
   * Generate a one-click unsubscribe URL for a recipient email address.
   * Token = base64url(email) — the /newsletter/unsubscribe endpoint verifies
   * this and marks the address as unsubscribed in the DB.
   */
  private unsubUrl(email: string): string {
    const backendUrl = this.config.get('BACKEND_URL') || 'https://api.kalokea.in';
    const token = Buffer.from(email.trim().toLowerCase()).toString('base64url');
    return `${backendUrl}/newsletter/unsubscribe?t=${token}`;
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
   * consistently in Gmail/Outlook). Brand: black header, sienna accent (#7C4A2D),
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
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7C4A2D;margin-top:4px;">Women&rsquo;s Fashion</div>
        </td></tr>
        <tr><td style="padding:38px 32px 34px;font-family:Arial,Helvetica,sans-serif;color:#0a0a0a;">
          ${opts.eyebrow ? `<p style="margin:0 0 10px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#7C4A2D;">${opts.eyebrow}</p>` : ''}
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
    guest_email?: string;  // appended to invoice link so guest can view without auth
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

    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.in';
    const backendUrl = this.config.get('BACKEND_URL') || 'https://api.kalokea.in';
    const trackLink = `${siteUrl}/account/orders/`;
    const invoiceLink = vars.order_db_id
      ? `${backendUrl}/orders/${vars.order_db_id}/invoice${vars.guest_email ? `?guest_email=${encodeURIComponent(vars.guest_email)}` : ''}`
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
        Hi ${vars.customer_name}, thank you for your order. Your booking is confirmed &mdash; we&rsquo;ll let you know as soon as it ships. You can view and print your GST tax invoice using the button below.
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

    // No HTML attachment — Gmail shows raw .html code. The "View Invoice" link
    // in the email body opens the properly-rendered invoice page instead.
    await this.send(to, `Order confirmed — #${vars.order_id}`, html, undefined, 'order_confirmation');
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
    const unsubUrl = this.unsubUrl(to);

    const body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Welcome to the Kalokea family. You&rsquo;ll be first to hear about new arrivals,
        exclusive offers, and style inspiration &mdash; straight to your inbox.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 0;">
        <tr><td style="border-radius:6px;background:#0a0a0a;">
          <a href="https://kalokea.in/shop/" style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;">Shop New Arrivals</a>
        </td></tr>
      </table>
    `;
    const html = this.layout({
      preheader: 'Welcome to Kalokea — new arrivals, offers & style inspiration.',
      eyebrow: 'Welcome',
      heading: 'You&rsquo;re on the list',
      body,
      // Legally required unsubscribe link (CAN-SPAM / DPDP Act 2023)
      footerNote: `Not interested? <a href="${unsubUrl}" style="color:#7C4A2D;text-decoration:underline;">Unsubscribe</a> at any time.`,
    });
    await this.send(to, 'Welcome to Kalokea', html, undefined, 'newsletter_welcome');
  }

  /** Admin: send a newsletter campaign with custom subject and HTML body */
  async sendNewsletterCampaign(to: string, subject: string, bodyHtml: string, previewText?: string): Promise<void> {
    const unsubUrl = this.unsubUrl(to);
    const html = this.layout({
      preheader: previewText || subject,
      eyebrow: 'Newsletter',
      heading: subject,
      body: bodyHtml,
      footerNote: `Not interested? <a href="${unsubUrl}" style="color:#7C4A2D;text-decoration:underline;">Unsubscribe</a> at any time.`,
    });
    await this.send(to, subject, html, undefined, 'newsletter_campaign');
  }

  // ── Back in stock ─────────────────────────────────────────────────────────

  async sendBackInStock(to: string, vars: {
    productName: string;
    variantLabel: string;
    productSlug: string;
    siteUrl: string;
  }): Promise<void> {
    const unsubUrl = this.unsubUrl(to);
    const productUrl = `${vars.siteUrl}/product/${vars.productSlug}/`;
    const body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Good news! The item you were waiting for is back in stock.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="margin:0 0 24px;background:#faf8f5;border:1px solid #e8e4e0;border-radius:8px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 4px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#9a9a9a;">Item</p>
          <p style="margin:0;font-size:15px;color:#0a0a0a;font-weight:600;">${vars.productName}</p>
          <p style="margin:4px 0 0;font-size:13px;color:#6b6b6b;">${vars.variantLabel}</p>
        </td></tr>
      </table>
      <p style="margin:0 0 22px;font-size:13px;line-height:1.7;color:#6b6b6b;">
        Popular items sell out fast &mdash; grab yours before it&rsquo;s gone again.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr><td style="border-radius:6px;background:#0a0a0a;">
          <a href="${productUrl}"
             style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
            Shop Now
          </a>
        </td></tr>
      </table>
    `;
    const html = this.layout({
      preheader: `${vars.productName} (${vars.variantLabel}) is back in stock at Kalokea`,
      eyebrow: 'Back in Stock',
      heading: 'Your item is available again',
      body,
      footerNote: `You requested this alert. <a href="${unsubUrl}" style="color:#7C4A2D;text-decoration:underline;">Unsubscribe</a>`,
    });
    await this.send(to, `Back in stock: ${vars.productName}`, html, undefined, 'back_in_stock');
  }

  // ── Low stock ─────────────────────────────────────────────────────────────

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
    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.in';
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
          <a href="${siteUrl}/cart/"
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
    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.in';
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
          <a href="${siteUrl}/account/orders/"
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
    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.in';
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
          <a href="${siteUrl}/product/${vars.product_slug}/"
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
    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.in';
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
          <a href="${siteUrl}/account/orders/"
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
    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.in';
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
          <a href="${siteUrl}/shop/"
             style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
            Continue Shopping
          </a>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:13px;color:#6b6b6b;">
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

  /** Escape user-supplied text before embedding in HTML (prevents XSS in admin email). */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  async sendContactForm(vars: {
    name: string;
    email: string;
    message: string;
  }): Promise<void> {
    const adminEmail = this.config.get<string>('ADMIN_EMAIL');
    if (!adminEmail) return;
    // Escape all user-provided values before embedding in HTML (XSS prevention)
    const safeName    = this.escapeHtml(vars.name);
    const safeEmail   = this.escapeHtml(vars.email);
    const safeMessage = this.escapeHtml(vars.message);
    const body = `
      <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        A new message has been submitted via the contact form.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 22px;border:1px solid #e8e4e0;border-radius:6px;overflow:hidden;">
        <tr><td style="padding:12px 16px;background:#faf8f5;border-bottom:1px solid #e8e4e0;">
          <span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6b6b;">From</span>
        </td><td style="padding:12px 16px;background:#faf8f5;border-bottom:1px solid #e8e4e0;text-align:right;">
          <strong style="color:#0a0a0a;">${safeName}</strong> &lt;${safeEmail}&gt;
        </td></tr>
        <tr><td colspan="2" style="padding:16px;">
          <span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6b6b;">Message</span>
          <p style="margin:8px 0 0;font-size:14px;line-height:1.7;color:#0a0a0a;white-space:pre-wrap;">${safeMessage}</p>
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
          <span style="font-size:14px;color:#0a0a0a;margin-top:4px;display:block;">${this.escapeHtml(vars.reason)}</span>
        </td></tr>` : ''}
      </table>
      <p style="margin:0;font-size:13px;color:#6b6b6b;">Log in to the admin panel to review this return.</p>
    `;
    const html = this.layout({
      preheader: `Return filed for order #${vars.order_id}`,
      eyebrow: 'Returns & Refunds',
      heading: 'New return request',
      body,
    });
    await this.send(adminEmail, `Return filed — #${vars.order_id}`, html, undefined, 'admin_return_filed');
  }

  // ── Return rejected (customer notification) ────────────────────────────────

  async sendReturnRejected(to: string, vars: {
    customer_name: string;
    order_id: string;
    reason?: string;
  }): Promise<void> {
    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.in';
    const body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Hi ${vars.customer_name}, unfortunately we are unable to approve your return request
        for order <strong style="color:#0a0a0a;">#${vars.order_id}</strong>.
      </p>
      ${vars.reason ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="background:#faf8f5;border:1px solid #e8e4e0;border-radius:8px;margin-bottom:22px;">
        <tr><td style="padding:16px 20px;">
          <p style="margin:0 0 6px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#9a9a9a;">Reason</p>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#0a0a0a;">${this.escapeHtml(vars.reason)}</p>
        </td></tr>
      </table>` : ''}
      <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        If you believe this decision was made in error, please contact our support team at
        <a href="mailto:support@kalokea.in" style="color:#0a0a0a;">support@kalokea.in</a>.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr><td style="border-radius:6px;background:#0a0a0a;">
          <a href="${siteUrl}/account/orders/"
             style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
            View My Orders
          </a>
        </td></tr>
      </table>
    `;
    const html = this.layout({
      preheader: `Return request for order #${vars.order_id}`,
      eyebrow: 'Return Update',
      heading: 'Return request not approved',
      body,
    });
    await this.send(to, `Return request — #${vars.order_id}`, html, undefined, 'return_rejected');
  }

  // ── Order processing (picking & packing started) ───────────────────────────

  async sendOrderProcessing(to: string, vars: {
    customer_name: string;
    order_id: string;
  }): Promise<void> {
    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.in';
    const body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Hi ${vars.customer_name}, great news — your order
        <strong style="color:#0a0a0a;">#${vars.order_id}</strong> is now being picked
        and packed by our team.
      </p>
      <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        You will receive another email with your tracking details once it is
        handed to the courier.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr><td style="border-radius:6px;background:#0a0a0a;">
          <a href="${siteUrl}/account/orders/"
             style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
            Track My Order
          </a>
        </td></tr>
      </table>
    `;
    const html = this.layout({
      preheader: `Your order #${vars.order_id} is being packed`,
      eyebrow: 'Order Update',
      heading: 'Your order is being prepared',
      body,
    });
    await this.send(to, `Order in progress — #${vars.order_id}`, html, undefined, 'order_processing');
  }

  // ── Abandoned cart recovery ────────────────────────────────────────────────

  async sendAbandonedCartEmail(to: string, vars: {
    customer_name: string;
    items: Array<{
      name: string;
      variant: string;   // e.g. "M / Black"
      price: number;     // paise
      image_url?: string;
    }>;
  }): Promise<void> {
    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.in';
    const unsubUrl = this.unsubUrl(to);

    const itemRows = vars.items.map((item) => `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #e8e4e0;font-size:13px;color:#0a0a0a;">
          <strong>${item.name}</strong>
          <div style="font-size:11px;color:#6b6b6b;margin-top:2px;">${item.variant}</div>
        </td>
        <td style="padding:12px 16px;border-bottom:1px solid #e8e4e0;font-size:13px;color:#0a0a0a;text-align:right;white-space:nowrap;">
          ${this.money(item.price)}
        </td>
      </tr>`).join('');

    const body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Hi ${vars.customer_name}, you left some beautiful pieces behind.
        Your cart is saved and ready when you are.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="margin:0 0 24px;border:1px solid #e8e4e0;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#faf8f5;">
            <th style="padding:10px 16px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#9a9a9a;text-align:left;font-weight:normal;">Item</th>
            <th style="padding:10px 16px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#9a9a9a;text-align:right;font-weight:normal;">Price</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
        <tr><td style="border-radius:6px;background:#0a0a0a;">
          <a href="${siteUrl}/cart/"
             style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
            Return to Cart
          </a>
        </td></tr>
      </table>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#9a9a9a;">
        Items are reserved for a limited time. Complete your order before they sell out.
      </p>
    `;
    const html = this.layout({
      preheader: `You left items in your Kalokea cart — complete your order`,
      eyebrow: 'Your Cart',
      heading: 'You left something behind',
      body,
      // DPDPA compliance: marketing emails must include a one-click unsubscribe link
      footerNote: `You received this because you have items in your cart. <a href="${unsubUrl}" style="color:#7C4A2D;text-decoration:underline;">Unsubscribe</a>`,
    });
    await this.send(to, 'Your Kalokea cart is waiting', html, undefined, 'abandoned_cart');
  }

  // ── ShipRocket: AWB assigned ───────────────────────────────────────────────

  async sendOrderAwbAssigned(to: string, vars: {
    customer_name: string;
    order_id: string;
    awb_code: string;
    courier_name: string;
  }): Promise<void> {
    const body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Hi ${vars.customer_name}, your order <strong style="color:#0a0a0a;">#${vars.order_id}</strong>
        has been shipped via <strong style="color:#0a0a0a;">${vars.courier_name}</strong>.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
             style="margin:0 0 22px;border:1px solid #e8e4e0;border-radius:6px;overflow:hidden;">
        <tr><td style="padding:12px 16px;background:#faf8f5;border-bottom:1px solid #e8e4e0;">
          <span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6b6b;">AWB / Tracking</span>
        </td><td style="padding:12px 16px;background:#faf8f5;border-bottom:1px solid #e8e4e0;text-align:right;">
          <strong style="color:#0a0a0a;">${vars.awb_code}</strong>
        </td></tr>
        <tr><td style="padding:12px 16px;">
          <span style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#6b6b6b;">Courier</span>
        </td><td style="padding:12px 16px;text-align:right;">
          <strong style="color:#0a0a0a;">${vars.courier_name}</strong>
        </td></tr>
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr><td style="border-radius:6px;background:#0a0a0a;">
          <a href="https://shiprocket.co/tracking/${vars.awb_code}"
             style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
            Track Shipment
          </a>
        </td></tr>
      </table>
    `;
    const html = this.layout({
      preheader: `Your order #${vars.order_id} is on its way`,
      eyebrow: 'Shipment Update',
      heading: 'Your order has been shipped',
      body,
    });
    await this.send(to, `Shipped — #${vars.order_id}`, html, undefined, 'order_awb_assigned');
  }

  // ── Win-back (re-engagement) ───────────────────────────────────────────────

  async sendWinbackEmail(to: string, vars: { customer_name: string }): Promise<void> {
    const siteUrl = this.config.get('SITE_URL') || 'https://kalokea.in';
    const unsubUrl = this.unsubUrl(to);

    const body = `
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b6b6b;">
        Hi ${vars.customer_name}, it's been a while since your last order.
        We've added new styles since you last visited — come explore what's fresh.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
        <tr><td style="border-radius:6px;background:#0a0a0a;">
          <a href="${siteUrl}/shop/"
             style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
            Explore New Arrivals
          </a>
        </td></tr>
      </table>
      <p style="margin:0 0 12px;font-size:13px;line-height:1.7;color:#6b6b6b;">
        As a valued customer, you get free shipping on your next order — no code needed.
      </p>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#9a9a9a;">
        Questions? Reply to this email and our team will get back to you.
      </p>
    `;
    const html = this.layout({
      preheader: `We miss you — new styles are waiting for you at Kalokea`,
      eyebrow: 'We Miss You',
      heading: `It's been a while, ${vars.customer_name}`,
      body,
      footerNote: `You received this because you're a Kalokea customer. <a href="${unsubUrl}" style="color:#7C4A2D;text-decoration:underline;">Unsubscribe</a>`,
    });
    await this.send(to, `We miss you — new styles are here`, html, undefined, 'winback');
  }
}
