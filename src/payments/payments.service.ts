import { Injectable, BadRequestException, Logger, RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { GstService } from '../gst/gst.service';
import * as crypto from 'crypto';
import { Request } from 'express';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private db: DatabaseService,
    private config: ConfigService,
    private email: EmailService,
    private gst: GstService,
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
        .select('*, users(email, name), order_items(variant_id, quantity, snapshot_name, snapshot_price)')
        .eq('razorpay_order_id', razorpayOrderId)
        .single();

      // Idempotency: Razorpay can deliver the same webhook more than once.
      // Only confirm + deduct stock on the FIRST transition to paid, so stock
      // is never double-decremented on a duplicate delivery.
      if (order && order.payment_status !== 'paid') {
        await this.db.client.from('orders').update({
          payment_status: 'paid',
          status: 'confirmed',
          razorpay_payment_id: payment.id,
        }).eq('id', order.id);

        // Record the sale in the GST ledger (online orders post here, not at
        // creation — only a captured payment is a committed taxable sale).
        await this.gst.postSaleLedger(order.id);

        // Deduct stock now that payment is captured (online orders skip the
        // decrement at order creation — see OrdersService.createOrder).
        for (const item of (order.order_items as any[]) || []) {
          const { data: variant } = await this.db.client
            .from('product_variants')
            .select('stock')
            .eq('id', item.variant_id)
            .single();
          if (variant) {
            await this.db.client
              .from('product_variants')
              .update({ stock: Math.max(0, variant.stock - item.quantity) })
              .eq('id', item.variant_id);
          }
        }

        const userEmail = (order.users as any)?.email;
        if (userEmail) {
          await this.email.sendOrderConfirmation(userEmail, {
            customer_name: (order.users as any)?.name || 'Customer',
            order_id: order.order_number,
            total: order.total,
            items: ((order.order_items as any[]) || []).map((it) => ({
              name: it.snapshot_name,
              quantity: it.quantity,
              price: it.snapshot_price,
            })),
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
