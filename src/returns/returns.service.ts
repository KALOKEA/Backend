import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { GstService } from '../gst/gst.service';
import { EmailService } from '../email/email.service';
import { CreateReturnDto } from './dto/create-return.dto';

@Injectable()
export class ReturnsService {
  constructor(
    private db: DatabaseService,
    private gst: GstService,
    private email: EmailService,
  ) {}

  async create(dto: CreateReturnDto, userId: string) {
    // SECURITY: Verify the order belongs to this user before accepting a return.
    // Without this check, any authenticated user can file returns on other users' orders.
    const { data: order } = await this.db.client
      .from('orders')
      .select('id, user_id, fulfillment_status, delivered_at, created_at')
      .eq('id', dto.order_id)
      .single();

    if (!order) throw new NotFoundException('Order not found');

    if (order.user_id !== userId) {
      // Return same message as NotFoundException to avoid leaking order existence to attackers
      throw new NotFoundException('Order not found');
    }

    // Return eligibility: order must be delivered
    if (order.fulfillment_status !== 'delivered') {
      throw new BadRequestException('Returns can only be filed for delivered orders');
    }

    // 15-day return window enforcement (matches all storefront policy pages)
    const deliveredAt = order.delivered_at
      ? new Date(order.delivered_at).getTime()
      : new Date(order.created_at).getTime(); // fallback if delivered_at not set
    const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;
    if (Date.now() - deliveredAt > fifteenDaysMs) {
      throw new ForbiddenException('Return window has expired. Returns must be filed within 15 days of delivery.');
    }

    const { data, error } = await this.db.client
      .from('returns')
      .insert({ ...dto, user_id: userId, status: 'requested' })
      .select('*, orders(order_number), users(name, email)')
      .single();
    if (error) throw error;

    // Alert admin that a return has been filed
    const userEmail = (data.users as any)?.email;
    const orderNum = (data.orders as any)?.order_number || dto.order_id;
    if (userEmail) {
      this.email.sendAdminReturnFiled({
        customer_name: (data.users as any)?.name || 'Customer',
        customer_email: userEmail,
        order_id: orderNum,
        reason: dto.reason,
      }).catch(() => {});
    }

    return data;
  }

  async findAll() {
    const { data } = await this.db.client
      .from('returns')
      .select('*, orders(order_number), users(name, email)')
      .order('created_at', { ascending: false });
    return data || [];
  }

  async findByUser(userId: string) {
    const { data } = await this.db.client
      .from('returns')
      .select('*, orders(order_number)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return data || [];
  }

  async updateStatus(id: string, status: string, adminNotes?: string) {
    // Fetch full record (with user + order) before updating so we have email details
    const { data: existing } = await this.db.client
      .from('returns')
      .select('*, orders(order_number), users(name, email)')
      .eq('id', id)
      .single();

    const { data, error } = await this.db.client
      .from('returns')
      .update({ status, admin_notes: adminNotes, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select().single();
    if (error || !data) throw new NotFoundException('Return not found');

    // On final settlement, restock the returned item(s) and post a negative
    // (credit-note) row to the GST ledger so the period's net tax is reduced.
    if (status === 'completed' || status === 'refunded') {
      await this.restock(data);
      await this.gst.postReturnLedger(data.id);
    }

    // Send approval email when admin moves status to 'approved'
    if (status === 'approved' && existing) {
      const userEmail = (existing.users as any)?.email;
      if (userEmail) {
        this.email.sendReturnApproved(userEmail, {
          customer_name: (existing.users as any)?.name || 'Customer',
          order_id: (existing.orders as any)?.order_number || existing.order_id,
          instructions: adminNotes,
        }).catch(() => {});
      }
    }

    // Send rejection email when admin moves status to 'rejected'
    if (status === 'rejected' && existing) {
      const userEmail = (existing.users as any)?.email;
      if (userEmail) {
        this.email.sendReturnRejected(userEmail, {
          customer_name: (existing.users as any)?.name || 'Customer',
          order_id: (existing.orders as any)?.order_number || existing.order_id,
          reason: adminNotes,
        }).catch(() => {});
      }
    }

    return data;
  }

  /** Add the returned quantity back to variant stock. */
  private async restock(ret: any) {
    let items: any[] = [];
    if (ret.order_item_id) {
      const { data } = await this.db.client
        .from('order_items').select('variant_id, quantity').eq('id', ret.order_item_id);
      items = data || [];
    } else {
      const { data } = await this.db.client
        .from('order_items').select('variant_id, quantity').eq('order_id', ret.order_id);
      items = data || [];
    }
    for (const it of items) {
      if (!it.variant_id) continue;
      await this.db.client.rpc('restock_variant', {
        p_variant_id: it.variant_id,
        p_qty: it.quantity || 0,
      });
    }
  }
}
