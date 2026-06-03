import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { GstService } from '../gst/gst.service';
import { CreateExchangeDto } from './dto/create-exchange.dto';

/**
 * Exchange flow: a customer swaps an ordered line for a different variant.
 * Lifecycle: requested → approved → completed (or rejected).
 * On 'completed' we move stock (restock original, decrement new) and post the
 * GST impact to the ledger (a credit-note line for the returned item + a fresh
 * tax line for the new item). All money is paise; new item priced at current
 * variant price (no coupon re-application).
 */
@Injectable()
export class ExchangesService {
  private readonly logger = new Logger(ExchangesService.name);
  constructor(
    private db: DatabaseService,
    private gst: GstService,
  ) {}

  async create(dto: CreateExchangeDto, userId: string) {
    // Verify the order line belongs to this user's order.
    const { data: item } = await this.db.client
      .from('order_items')
      .select('*, orders!inner(id, user_id)')
      .eq('id', dto.order_item_id)
      .eq('order_id', dto.order_id)
      .single();
    if (!item) throw new NotFoundException('Order item not found');
    if ((item.orders as any).user_id !== userId) {
      throw new NotFoundException('Order item not found');
    }

    // Resolve the requested new variant (must be in stock).
    const { data: variant } = await this.db.client
      .from('product_variants')
      .select('id, price, size, colour, stock, products(name)')
      .eq('id', dto.new_variant_id)
      .single();
    if (!variant) throw new BadRequestException('Requested variant not found');
    if ((variant.stock ?? 0) < (item.quantity || 1)) {
      throw new BadRequestException('Requested variant is out of stock');
    }

    const qty = item.quantity || 1;
    const rate = Number(item.gst_rate) || 0;
    const originalPrice = (Number(item.snapshot_price) || 0) * qty;
    const newPrice = (Number(variant.price) || 0) * qty;
    const originalGst = Number(item.gst_amount) || 0;
    const newGst = this.gst.taxOn(newPrice, rate);

    const { data, error } = await this.db.client
      .from('exchanges')
      .insert({
        order_id: dto.order_id,
        order_item_id: dto.order_item_id,
        user_id: userId,
        new_variant_id: dto.new_variant_id,
        reason: dto.reason,
        status: 'requested',
        original_price: originalPrice,
        new_price: newPrice,
        price_difference: newPrice - originalPrice,
        gst_difference: newGst - originalGst,
        new_snapshot_name: (variant.products as any)?.name || item.snapshot_name,
        new_snapshot_size: variant.size,
        new_snapshot_colour: variant.colour,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  /** Sibling variants a customer can exchange an ordered line for (in stock,
   *  excluding the one they already have). Ownership enforced. */
  async getOptions(orderItemId: string, userId: string) {
    const { data: item } = await this.db.client
      .from('order_items')
      .select('id, variant_id, snapshot_name, quantity, orders!inner(user_id)')
      .eq('id', orderItemId)
      .single();
    if (!item || (item.orders as any).user_id !== userId) {
      throw new NotFoundException('Order item not found');
    }

    // Find the product behind the purchased variant, then its other variants.
    const { data: variant } = await this.db.client
      .from('product_variants')
      .select('product_id, products(name)')
      .eq('id', item.variant_id)
      .single();
    if (!variant) return { product_name: item.snapshot_name, variants: [] };

    const { data: variants } = await this.db.client
      .from('product_variants')
      .select('id, size, colour, price, stock')
      .eq('product_id', variant.product_id)
      .eq('is_active', true)
      .gt('stock', 0);

    return {
      product_name: (variant.products as any)?.name || item.snapshot_name,
      variants: (variants || []).filter((v) => v.id !== item.variant_id),
    };
  }

  async findByUser(userId: string) {
    const { data } = await this.db.client
      .from('exchanges')
      .select('*, orders(order_number)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return data || [];
  }

  async findAll() {
    const { data } = await this.db.client
      .from('exchanges')
      .select('*, orders(order_number), users(name, email)')
      .order('created_at', { ascending: false });
    return data || [];
  }

  async updateStatus(id: string, status: string, adminNotes?: string) {
    if (!['requested', 'approved', 'rejected', 'completed'].includes(status)) {
      throw new BadRequestException('Invalid status');
    }
    const { data, error } = await this.db.client
      .from('exchanges')
      .update({ status, admin_notes: adminNotes, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*, order_items(variant_id, quantity)')
      .single();
    if (error || !data) throw new NotFoundException('Exchange not found');

    if (status === 'completed') {
      await this.applyStockSwap(data);
      await this.gst.postExchangeLedger(data.id);
    }
    return data;
  }

  /** Restock the original variant; decrement the new variant. Idempotent guard
   *  via the ledger check is handled by postExchangeLedger; stock is moved once
   *  here on the transition to completed. */
  private async applyStockSwap(ex: any) {
    const qty = (ex.order_items as any)?.quantity || 1;
    const originalVariantId = (ex.order_items as any)?.variant_id;

    // Atomic: put the original back, take the new one (guarded so it can't go
    // negative). Logs if the new variant ran out between request and approval.
    if (originalVariantId) {
      await this.db.client.rpc('restock_variant', { p_variant_id: originalVariantId, p_qty: qty });
    }
    if (ex.new_variant_id) {
      const { data: ok } = await this.db.client.rpc('decrement_stock', {
        p_variant_id: ex.new_variant_id,
        p_qty: qty,
      });
      if (ok !== true) {
        this.logger.warn(`Exchange ${ex.id}: new variant ${ex.new_variant_id} out of stock at completion`);
      }
    }
  }
}
