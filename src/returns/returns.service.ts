import { Injectable, NotFoundException } from '@nestjs/common';
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
    const { data, error } = await this.db.client
      .from('returns')
      .insert({ ...dto, user_id: userId, status: 'requested' })
      .select().single();
    if (error) throw error;
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
