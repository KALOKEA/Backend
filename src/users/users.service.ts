import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private db: DatabaseService) {}

  async findOne(id: string) {
    const { data } = await this.db.client
      .from('users')
      .select('id, name, email, phone, role, created_at')
      .eq('id', id)
      .single();
    if (!data) throw new NotFoundException('User not found');
    return data;
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    const { data, error } = await this.db.client
      .from('users')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, name, email, phone, role')
      .single();
    if (error) throw error;
    return data;
  }

  async findAll(page = 1, limit = 20) {
    const from = (page - 1) * limit;
    const { data, count } = await this.db.client
      .from('users')
      .select('id, name, email, phone, role, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);
    return { data, meta: { total: count, page, limit } };
  }

  /** Full profile + order history for one customer (admin). */
  async getDetail(id: string) {
    const { data: user } = await this.db.client
      .from('users')
      .select('id, name, email, phone, role, created_at')
      .eq('id', id)
      .single();
    if (!user) throw new NotFoundException('User not found');

    const { data: orders } = await this.db.client
      .from('orders')
      .select('id, order_number, status, payment_status, total, created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false });

    const paid = (orders || []).filter((o: any) => o.payment_status === 'paid');
    const stats = {
      total_orders: (orders || []).length,
      total_spent: paid.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0),
      last_order_at: orders && orders.length ? orders[0].created_at : null,
    };
    return { user, orders: orders || [], stats };
  }

  /**
   * One-click export of ALL customer data as CSV (admin). Includes per-user
   * order count, total spent (paid, paise) and last order date. All money in
   * paise; the CSV shows rupees. Use for backups / GDPR-style data requests.
   */
  async exportAllCsv(): Promise<string> {
    const { data: users } = await this.db.client
      .from('users')
      .select('id, name, email, phone, role, created_at')
      .order('created_at', { ascending: false });

    const { data: orders } = await this.db.client
      .from('orders')
      .select('user_id, total, payment_status, created_at');

    // Aggregate order stats per user in one pass.
    const stats = new Map<string, { count: number; spent: number; last: string | null }>();
    for (const o of orders || []) {
      if (!o.user_id) continue;
      const s = stats.get(o.user_id) || { count: 0, spent: 0, last: null };
      s.count += 1;
      if (o.payment_status === 'paid') s.spent += Number(o.total) || 0;
      if (!s.last || new Date(o.created_at) > new Date(s.last)) s.last = o.created_at;
      stats.set(o.user_id, s);
    }

    const rupees = (p: number) => (p / 100).toFixed(2);
    const header = ['Name', 'Email', 'Phone', 'Role', 'Joined', 'Total Orders', 'Total Spent (INR)', 'Last Order'];
    const rows = (users || []).map((u: any) => {
      const s = stats.get(u.id) || { count: 0, spent: 0, last: null };
      return [
        u.name || '',
        u.email || '',
        u.phone || '',
        u.role || 'customer',
        u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN') : '',
        s.count,
        rupees(s.spent),
        s.last ? new Date(s.last).toLocaleDateString('en-IN') : '',
      ];
    });

    const esc = (v: string | number) => {
      const str = String(v ?? '');
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    return [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  }
}
