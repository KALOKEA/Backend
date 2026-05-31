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
    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#0D0D0D">Your Kalokea login code</h2>
        <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#B8860B">${otp}</p>
        <p>This code expires in 5 minutes. Do not share it with anyone.</p>
        <p style="color:#999;font-size:12px">If you didn't request this, ignore this email.</p>
      </div>
    `;
    await this.send(to, 'Your Kalokea OTP', html);
  }

  async sendOrderConfirmation(to: string, vars: {
    customer_name: string;
    order_id: string;
    total: number;
    items: string;
  }): Promise<void> {
    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2>Order Confirmed! 🎉</h2>
        <p>Hi ${vars.customer_name}, your order <strong>#${vars.order_id}</strong> has been placed.</p>
        <p>Items: ${vars.items}</p>
        <p><strong>Total: ₹${vars.total}</strong></p>
        <p>We'll notify you when it ships.</p>
      </div>
    `;
    await this.send(to, `Order Confirmed — #${vars.order_id}`, html);
  }

  async sendOrderShipped(to: string, vars: {
    customer_name: string;
    order_id: string;
    tracking_number: string;
    courier_name: string;
  }): Promise<void> {
    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2>Your order is on its way! 🚚</h2>
        <p>Hi ${vars.customer_name}, order <strong>#${vars.order_id}</strong> has been shipped.</p>
        <p>Courier: ${vars.courier_name} | Tracking: <strong>${vars.tracking_number}</strong></p>
      </div>
    `;
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
        <p><strong>Total: ₹${vars.total}</strong></p>
      </div>
    `;
    await this.send(adminEmail, `New Order — ₹${vars.total}`, html);
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
