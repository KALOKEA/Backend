import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';

/** Fallback when store_settings.low_stock_threshold is not set. */
const DEFAULT_LOW_STOCK_THRESHOLD = 5;

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private db: DatabaseService,
    private email: EmailService,
  ) {}

  /**
   * Expire soft stock reservations that are past their TTL.
   * Reservations are created when a Razorpay checkout starts (15-min window).
   * This cron runs every 5 minutes so abandoned sessions release stock promptly.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireStockReservations() {
    try {
      await this.db.client.rpc('expire_stock_reservations');
      this.logger.debug('expire_stock_reservations ran');
    } catch (err: any) {
      // Migration 008 may not have been applied yet — non-fatal.
      this.logger.warn(`expire_stock_reservations failed (run migration 008): ${err?.message}`);
    }
  }

  /**
   * Delete OTP sessions that are expired OR already used, older than 24 hours.
   * Prevents unbounded growth of the otp_sessions table.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanUpOtpSessions() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { error } = await this.db.client
      .from('otp_sessions')
      .delete()
      .or(`used.eq.true,expires_at.lt.${cutoff}`);
    if (error) {
      this.logger.error(`OTP session cleanup failed: ${error.message}`);
    } else {
      this.logger.debug('OTP session cleanup complete');
    }
  }

  /**
   * Check for low-stock variants and email the admin if any are found.
   * Runs once daily at 8 AM so the team sees alerts at the start of the day.
   */
  @Cron('0 8 * * *')
  async checkLowStock() {
    try {
      // Read threshold from admin store_settings (configurable), fall back to default.
      const { data: settings } = await this.db.client
        .from('store_settings')
        .select('low_stock_threshold')
        .limit(1)
        .single();
      const threshold: number = settings?.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

      const { data: variants } = await this.db.client
        .from('product_variants')
        .select('id, sku, size, colour, stock, products(name)')
        .lte('stock', threshold)
        .gt('stock', 0)
        .eq('is_active', true);

      if (!variants || variants.length === 0) return;

      // Send one alert per low-stock variant (matches email.service.ts signature).
      for (const v of variants) {
        const productName = (v.products as any)?.name || 'Unknown';
        const variantLabel = [v.size, v.colour].filter(Boolean).join(' / ') || v.sku;
        await this.email.sendLowStockAlert({
          product_name: productName,
          variant: variantLabel,
          current_stock: v.stock,
        }).catch((err: any) => {
          this.logger.error(`Low stock alert email failed for ${productName}: ${err?.message}`);
        });
      }
      this.logger.log(`Low stock alert sent for ${variants.length} variant(s)`);
    } catch (err: any) {
      this.logger.error(`Low stock check failed: ${err?.message}`);
    }
  }

  /**
   * Abandoned cart recovery — runs every hour.
   *
   * Finds authenticated users whose cart was last updated between 1 and 24 hours
   * ago, still has items, has not placed an order in the last 24 hours, and has
   * not already received an abandoned-cart email in the last 24 hours.
   *
   * Only authenticated users are targeted (guest carts have no email address).
   * The email_log table prevents duplicate sends within the 24-hour window.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async sendAbandonedCartEmails() {
    try {
      const now = new Date();
      const oneHourAgo  = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
      const dayAgo       = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

      // Step 1 — find carts updated in the 1–24 hour window belonging to users.
      const { data: carts, error: cartErr } = await this.db.client
        .from('carts')
        .select(`
          id,
          user_id,
          updated_at,
          cart_items(
            id,
            quantity,
            product_variants(
              size,
              colour,
              price,
              products(name)
            )
          )
        `)
        .not('user_id', 'is', null)
        .lte('updated_at', oneHourAgo)
        .gte('updated_at', dayAgo);

      if (cartErr) {
        this.logger.error(`Abandoned cart query failed: ${cartErr.message}`);
        return;
      }
      if (!carts || carts.length === 0) return;

      // Only carts that actually have items
      const cartsWithItems = carts.filter(
        (c: any) => Array.isArray(c.cart_items) && c.cart_items.length > 0,
      );
      if (cartsWithItems.length === 0) return;

      const userIds = cartsWithItems.map((c: any) => c.user_id);

      // Step 2 — get user emails (profile table)
      const { data: users, error: usersErr } = await this.db.client
        .from('users')
        .select('id, email, full_name')
        .in('id', userIds);

      if (usersErr || !users) {
        this.logger.error(`Abandoned cart user lookup failed: ${usersErr?.message}`);
        return;
      }
      const userMap = new Map(users.map((u: any) => [u.id, u]));

      // Step 3 — filter out users who placed an order in the last 24 hours
      const { data: recentOrders } = await this.db.client
        .from('orders')
        .select('user_id')
        .in('user_id', userIds)
        .gte('created_at', dayAgo);

      const usersWithRecentOrders = new Set(
        (recentOrders ?? []).map((o: any) => o.user_id),
      );

      // Step 4 — filter out users who already got an abandoned-cart email today
      const { data: recentEmails } = await this.db.client
        .from('email_log')
        .select('recipient')
        .eq('email_type', 'abandoned_cart')
        .gte('created_at', dayAgo);

      const emailedRecipients = new Set(
        (recentEmails ?? []).map((e: any) => e.recipient),
      );

      // Step 5 — send emails
      let sent = 0;
      for (const cart of cartsWithItems) {
        const user = userMap.get(cart.user_id);
        if (!user?.email) continue;
        if (usersWithRecentOrders.has(cart.user_id)) continue;
        if (emailedRecipients.has(user.email)) continue;

        const items = (cart.cart_items as any[]).map((ci: any) => {
          const variant = ci.product_variants;
          const product = variant?.products;
          const variantLabel = [variant?.size, variant?.colour].filter(Boolean).join(' / ') || 'One Size';
          return {
            name: product?.name || 'Item',
            variant: variantLabel,
            price: variant?.price ?? 0,
          };
        });

        await this.email.sendAbandonedCartEmail(user.email, {
          customer_name: user.full_name || 'there',
          items,
        }).catch((err: any) => {
          this.logger.error(`Abandoned cart email failed for ${user.email}: ${err?.message}`);
        });

        sent++;
      }

      if (sent > 0) {
        this.logger.log(`Abandoned cart: sent ${sent} recovery email(s)`);
      }
    } catch (err: any) {
      this.logger.error(`Abandoned cart cron failed: ${err?.message}`);
    }
  }
}
