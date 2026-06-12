import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class StockNotificationsService {
  private readonly logger = new Logger(StockNotificationsService.name);

  constructor(
    private db: DatabaseService,
    private email: EmailService,
  ) {}

  /**
   * Register an email to be notified when the given variant comes back in stock.
   * Idempotent: subscribing the same (variant, email) twice is a no-op.
   */
  async subscribe(variantId: string, emailAddress: string): Promise<void> {
    // Verify the variant exists and is actually out of stock.
    const { data: variant } = await this.db.client
      .from('product_variants')
      .select('id, stock, size, colour, products(name)')
      .eq('id', variantId)
      .maybeSingle();

    if (!variant) throw new BadRequestException('Variant not found');
    if (variant.stock > 0) throw new BadRequestException('This item is already in stock');

    const normalized = emailAddress.trim().toLowerCase();

    const { error } = await this.db.client
      .from('stock_notifications')
      .upsert(
        { variant_id: variantId, email: normalized, sent: false },
        // conflict on the partial unique index (variant_id, email WHERE sent=false)
        // If the row already exists (pending), this is a no-op.
        { onConflict: 'variant_id,email', ignoreDuplicates: true },
      );

    if (error) {
      this.logger.error(`Stock notification subscribe failed: ${error.message}`);
      throw new BadRequestException('Failed to register notification. Please try again.');
    }
  }

  /**
   * Called by the cron job. Finds all variants that have come back in stock
   * (stock > 0) and have pending notifications. Sends emails and marks them sent.
   */
  async sendPendingNotifications(): Promise<number> {
    // Find all pending notification variant IDs.
    const { data: pending, error } = await this.db.client
      .from('stock_notifications')
      .select('id, variant_id, email')
      .eq('sent', false);

    if (error) {
      this.logger.error(`stock_notifications fetch failed: ${error.message}`);
      return 0;
    }
    if (!pending || pending.length === 0) return 0;

    // Group by variant_id to avoid querying the same variant multiple times.
    const variantGroups = new Map<string, typeof pending>();
    for (const row of pending) {
      if (!variantGroups.has(row.variant_id)) variantGroups.set(row.variant_id, []);
      variantGroups.get(row.variant_id)!.push(row);
    }

    let sent = 0;

    for (const [variantId, subs] of variantGroups) {
      // Only send if the variant is actually back in stock.
      const { data: variant } = await this.db.client
        .from('product_variants')
        .select('id, stock, size, colour, products(name, slug)')
        .eq('id', variantId)
        .maybeSingle();

      if (!variant || variant.stock <= 0) continue; // still out of stock — skip

      const productName = (variant.products as any)?.name || 'Item';
      const productSlug = (variant.products as any)?.slug || '';
      const variantLabel = [variant.size, variant.colour].filter(Boolean).join(' / ') || 'One Size';

      for (const sub of subs) {
        await this.sendBackInStockEmail(sub.email, productName, variantLabel, productSlug)
          .catch((err) => this.logger.error(`Back-in-stock email failed for ${sub.email}: ${err?.message}`));

        // Mark as sent.
        await this.db.client
          .from('stock_notifications')
          .update({ sent: true, sent_at: new Date().toISOString() })
          .eq('id', sub.id);

        sent++;
      }
    }

    return sent;
  }

  private async sendBackInStockEmail(
    to: string,
    productName: string,
    variantLabel: string,
    productSlug: string,
  ): Promise<void> {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://kalokea.in';
    // Delegate to EmailService using the layout shell for brand consistency.
    // We call the private send method indirectly via a dedicated public wrapper
    // added in email.service.ts.
    await this.email.sendBackInStock(to, { productName, variantLabel, productSlug, siteUrl });
  }
}
