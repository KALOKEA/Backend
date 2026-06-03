import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AdminService {
  constructor(private db: DatabaseService) {}

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
    const { data } = await this.db.client
      .from('order_items')
      .select('snapshot_name, snapshot_sku, quantity, snapshot_price')
      .limit(200);

    if (!data) return [];

    const productMap: Record<string, { name: string; revenue: number; units: number }> = {};
    for (const item of data) {
      if (!productMap[item.snapshot_name]) {
        productMap[item.snapshot_name] = { name: item.snapshot_name, revenue: 0, units: 0 };
      }
      productMap[item.snapshot_name].revenue += item.snapshot_price * item.quantity;
      productMap[item.snapshot_name].units += item.quantity;
    }

    return Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit);
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
}
