import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class AdminService {
  constructor(
    private db: DatabaseService,
    private email: EmailService,
  ) {}

  async getDashboard() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [ordersResult, revenueResult, customersResult, pendingResult, lowStockResult] = await Promise.all([
      this.db.client.from('orders').select('id', { count: 'exact' }).gte('created_at', startOfMonth),
      this.db.client.from('orders').select('total').eq('payment_status', 'paid').gte('created_at', startOfMonth),
      this.db.client.from('users').select('id', { count: 'exact' }).gte('created_at', startOfMonth),
      this.db.client.from('orders').select('id', { count: 'exact' }).eq('status', 'pending'),
      this.db.client.from('product_variants').select('id, sku, stock, products(name)').lte('stock', 5).eq('is_active', true).limit(10),
    ]);

    const revenue = (revenueResult.data || []).reduce((sum: number, o: any) => sum + parseFloat(o.total), 0);

    return {
      orders_this_month: ordersResult.count || 0,
      revenue_this_month: revenue,
      new_customers: customersResult.count || 0,
      pending_orders: pendingResult.count || 0,
      low_stock_variants: lowStockResult.data || [],
    };
  }

  async getRecentOrders(limit = 10) {
    const { data } = await this.db.client
      .from('orders')
      .select('id, order_number, status, total, payment_method, created_at, users(name)')
      .order('created_at', { ascending: false })
      .limit(limit);
    return data || [];
  }

  async getTopProducts(limit = 10) {
    // Aggregate in the DB (single query, no N+1) using Supabase RPC or raw
    // select with SUM. Supabase JS client doesn't expose GROUP BY natively, so
    // we fetch all order_items for paid orders only and aggregate in JS — but
    // crucially we now filter to paid orders first to avoid counting cancelled
    // order revenue, and apply the limit after aggregation.
    const { data } = await this.db.client
      .from('order_items')
      .select('snapshot_name, quantity, snapshot_price, orders!inner(payment_status)')
      .eq('orders.payment_status', 'paid');

    if (!data) return [];

    const map: Record<string, { name: string; revenue: number; units: number }> = {};
    for (const item of data) {
      if (!map[item.snapshot_name]) {
        map[item.snapshot_name] = { name: item.snapshot_name, revenue: 0, units: 0 };
      }
      map[item.snapshot_name].revenue += item.snapshot_price * item.quantity;
      map[item.snapshot_name].units += item.quantity;
    }

    return Object.values(map)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
  }

  /** Monthly revenue + order count for the past N months (for the analytics chart). */
  async getMonthlyStats(months = 6) {
    const since = new Date();
    since.setMonth(since.getMonth() - months + 1);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const { data } = await this.db.client
      .from('orders')
      .select('total, created_at')
      .eq('payment_status', 'paid')
      .gte('created_at', since.toISOString());

    // Bucket by YYYY-MM
    const buckets: Record<string, { month: string; revenue: number; orders: number }> = {};
    for (let i = 0; i < months; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - (months - 1 - i));
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      buckets[key] = { month: key, revenue: 0, orders: 0 };
    }

    for (const row of data || []) {
      const key = row.created_at.slice(0, 7);
      if (buckets[key]) {
        buckets[key].revenue += Number(row.total);
        buckets[key].orders += 1;
      }
    }

    return Object.values(buckets);
  }

  async getActivityLog(page = 1, limit = 50, action?: string, entityType?: string) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let q = this.db.client
      .from('admin_activity_log')
      .select(
        'id, action, entity_type, entity_id, details, created_at, users(name, email)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(from, to);

    if (action) q = q.eq('action', action);
    if (entityType) q = q.eq('entity_type', entityType);

    const { data, count } = await q;
    return {
      data: data || [],
      meta: { total: count || 0, page, limit, total_pages: Math.ceil((count || 0) / limit) },
    };
  }

  async getEmailLog(page = 1, limit = 50, status?: string, emailType?: string) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let q = this.db.client
      .from('email_log')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (status) q = q.eq('status', status);
    if (emailType) q = q.eq('email_type', emailType);

    const { data, count } = await q;
    return {
      data: data || [],
      meta: { total: count || 0, page, limit, total_pages: Math.ceil((count || 0) / limit) },
    };
  }

  async getEmailLogEntry(id: string) {
    const { data, error } = await this.db.client
      .from('email_log')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) throw new NotFoundException('Email log entry not found');
    return data;
  }

  /** Resend a failed email by re-sending it via EmailService based on email_type */
  async resendEmail(id: string) {
    const entry = await this.getEmailLogEntry(id);
    const to: string = entry.recipient;
    const type: string = entry.email_type;
    const metadata: any = entry.metadata || {};

    switch (type) {
      case 'newsletter_welcome':
        await this.email.sendNewsletterWelcome(to);
        break;
      case 'order_confirmation':
        // Re-send order confirmation: fetch order details
        if (metadata.order_id) {
          const { data: order } = await this.db.client
            .from('orders')
            .select('*, order_items(*), users(name, email)')
            .eq('id', metadata.order_id)
            .single();
          if (order) await this.email.sendOrderConfirmation(to, order as any);
        }
        break;
      default:
        // Generic resend: update retry count and mark as retrying
        await this.db.client
          .from('email_log')
          .update({ status: 'retrying', retry_count: (entry.retry_count || 0) + 1 })
          .eq('id', id);
        return { message: `Email type '${type}' queued for retry` };
    }

    await this.db.client
      .from('email_log')
      .update({ status: 'sent', retry_count: (entry.retry_count || 0) + 1, error_message: null })
      .eq('id', id);

    return { message: 'Email resent successfully' };
  }

  /** Customer Lifetime Value: average total spend per paying customer */
  async getCustomerLifetimeValue() {
    const { data } = await this.db.client
      .from('orders')
      .select('user_id, total')
      .eq('payment_status', 'paid')
      .not('user_id', 'is', null);

    if (!data || data.length === 0) return { avg_clv: 0, total_paying_customers: 0, total_revenue: 0 };

    const customerSpend: Record<string, number> = {};
    let totalRevenue = 0;
    for (const order of data) {
      if (!customerSpend[order.user_id]) customerSpend[order.user_id] = 0;
      customerSpend[order.user_id] += Number(order.total);
      totalRevenue += Number(order.total);
    }
    const values = Object.values(customerSpend);
    const avgClv = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;

    return {
      avg_clv: Math.round(avgClv),
      total_paying_customers: values.length,
      total_revenue: Math.round(totalRevenue),
    };
  }

  /** Conversion Rate: % of users with at least one paid order */
  async getConversionRate() {
    const [{ count: totalUsers }, { data: paidOrders }] = await Promise.all([
      this.db.client.from('users').select('id', { count: 'exact' }).eq('role', 'user'),
      this.db.client.from('orders').select('user_id').eq('payment_status', 'paid').not('user_id', 'is', null),
    ]);

    const uniqueBuyers = new Set((paidOrders || []).map((o: any) => o.user_id)).size;
    const convRate = totalUsers && totalUsers > 0 ? (uniqueBuyers / totalUsers) * 100 : 0;
    return {
      conversion_rate: Math.round(convRate * 10) / 10,
      total_users: totalUsers || 0,
      unique_buyers: uniqueBuyers,
    };
  }

  /** Sales by category — revenue grouped by category */
  async getSalesByCategory() {
    const { data } = await this.db.client
      .from('order_items')
      .select('snapshot_name, quantity, snapshot_price, orders!inner(payment_status)')
      .eq('orders.payment_status', 'paid');

    if (!data) return [];
    // Note: without category in snapshot we approximate by order_items product join
    const { data: catData } = await this.db.client
      .from('order_items')
      .select(`
        quantity,
        snapshot_price,
        product_variants!inner(
          products!inner(
            categories(name)
          )
        ),
        orders!inner(payment_status)
      `)
      .eq('orders.payment_status', 'paid')
      .limit(500);

    const catMap: Record<string, { category: string; revenue: number; units: number }> = {};
    for (const item of catData || []) {
      const cat = (item as any)?.product_variants?.products?.categories?.name || 'Uncategorised';
      if (!catMap[cat]) catMap[cat] = { category: cat, revenue: 0, units: 0 };
      catMap[cat].revenue += Number(item.snapshot_price) * Number(item.quantity);
      catMap[cat].units += Number(item.quantity);
    }
    return Object.values(catMap).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }
}
