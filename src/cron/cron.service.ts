import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';

/** Alert when a variant's stock drops to this level or below. */
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
      const threshold = DEFAULT_LOW_STOCK_THRESHOLD;

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
}
