import { Injectable, BadRequestException, Logger, RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import * as crypto from 'crypto';
import { Request } from 'express';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private db: DatabaseService,
    private config: ConfigService,
    private email: EmailService,
  ) {}

  async createRazorpayOrder(orderId: string) {
    const keyId = this.config.get('RAZORPAY_KEY_ID');
    const keySecret = this.config.get('RAZORPAY_KEY_SECRET');

    const { data: order } = await this.db.client
      .from('orders').select('*').eq('id', orderId).single();
    if (!order) throw new BadRequestException('Order not found');

    const amount = Math.round(order.total); // order.total is already stored in paise (Razorpay's unit)

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({ amount, currency: 'INR', receipt: order.order_number }),
    });

    const razorpayOrder: any = await response.json();
    if (!response.ok) throw new BadRequestException(razorpayOrder.error?.description || 'Razorpay error');

    await this.db.client.from('orders')
      .update({ razorpay_order_id: razorpayOrder.id })
      .eq('id', orderId);

    return {
      razorpay_order_id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key_id: keyId,
    };
  }

  async handleWebhook(req: RawBodyRequest<Request>) {
    const webhookSecret = this.config.get('RAZORPAY_WEBHOOK_SECRET');
    const signature = req.headers['x-razorpay-signature'] as string;
    const rawBody = req.rawBody;

    if (!rawBody) throw new BadRequestException('No raw body');

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison to avoid signature timing attacks.
    const expectedBuf = Buffer.from(expectedSignature, 'hex');
    const providedBuf = Buffer.from(signature || '', 'hex');
    if (
      expectedBuf.length !== providedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      this.logger.warn('Invalid Razorpay webhook signature');
      throw new BadRequestException('Invalid signature');
    }

    const payload = JSON.parse(rawBody.toString());
    const event = payload.event;

    if (event === 'payment.captured') {
      const payment = payload.payload.payment.entity;
      const razorpayOrderId = payment.order_id;

      const { data: order } = await this.db.client
        .from('orders')
        .select('*, users(email, name)')
        .eq('razorpay_order_id', razorpayOrderId)
        .single();

      if (order) {
        await this.db.client.from('orders').update({
          payment_status: 'paid',
          status: 'confirmed',
          razorpay_payment_id: payment.id,
        }).eq('id', order.id);

        const userEmail = (order.users as any)?.email;
        if (userEmail) {
          await this.email.sendOrderConfirmation(userEmail, {
            customer_name: (order.users as any)?.name || 'Customer',
            order_id: order.order_number,
            total: order.total,
            items: 'your items',
          });
        }

        await this.email.sendAdminNewOrder({
          order_id: order.order_number,
          customer_name: (order.users as any)?.name || order.guest_phone || 'Guest',
          total: order.total,
          items_count: 1,
          payment_method: 'Razorpay',
        });
      }
    }

    if (event === 'payment.failed') {
      const payment = payload.payload.payment.entity;
      await this.db.client.from('orders')
        .update({ payment_status: 'failed' })
        .eq('razorpay_order_id', payment.order_id);
    }

    return { received: true };
  }
}
