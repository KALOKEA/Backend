import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { CouponsService } from '../coupons/coupons.service';
import { SettingsService } from '../settings/settings.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private db: DatabaseService,
    private email: EmailService,
    private coupons: CouponsService,
    private settings: SettingsService,
  ) {}

  private generateOrderNumber(): string {
    return `KLK-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }

  async createOrder(dto: CreateOrderDto, userId?: string) {
    // Get cart items
    let cartQuery = this.db.client.from('carts').select('id');
    if (userId) cartQuery = cartQuery.eq('user_id', userId);
    else if (dto.session_id) cartQuery = cartQuery.eq('session_id', dto.session_id).is('user_id', null);
    else throw new BadRequestException('User or session required');

    const { data: cart } = await cartQuery.single();
    if (!cart) throw new BadRequestException('Cart not found');

    const { data: cartItems } = await this.db.client
      .from('cart_items')
      .select(`
        quantity,
        product_variants(id, sku, size, colour, price, stock,
          products(name, product_images(url, is_primary)))
      `)
      .eq('cart_id', cart.id);

    if (!cartItems || cartItems.length === 0) throw new BadRequestException('Cart is empty');

    // Resolve the delivery address into a snapshot.
    // Logged-in users send address_id (we load + verify ownership, since the
    // service-role key bypasses RLS). Guests may send address_snapshot directly.
    let addressSnapshot = dto.address_snapshot;
    if (dto.address_id) {
      if (!userId) throw new BadRequestException('Login required to use a saved address');
      const { data: address } = await this.db.client
        .from('addresses')
        .select('name, phone, line1, line2, city, state, pincode')
        .eq('id', dto.address_id)
        .eq('user_id', userId)
        .single();
      if (!address) throw new BadRequestException('Address not found');
      addressSnapshot = address;
    }
    if (!addressSnapshot) throw new BadRequestException('Delivery address required');

    // Normalize payment method. The storefront offers upi/card/netbanking/wallet,
    // but those are all Razorpay sub-methods — only COD is a distinct gateway.
    const paymentMethod = dto.payment_method === 'cod' ? 'cod' : 'razorpay';

    // Calculate totals
    let subtotal = 0;
    const orderItems = cartItems.map((item: any) => {
      const variant = item.product_variants;
      const product = variant.products;
      const price = variant.price;
      // Guard against overselling / negative stock
      if (variant.stock == null || variant.stock < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for ${product?.name || 'item'}${variant.size ? ` (${variant.size})` : ''}`,
        );
      }
      subtotal += price * item.quantity;
      const primaryImage = product.product_images?.find((i: any) => i.is_primary)?.url || product.product_images?.[0]?.url;
      return {
        variant_id: variant.id,
        snapshot_name: product.name,
        snapshot_sku: variant.sku,
        snapshot_size: variant.size,
        snapshot_colour: variant.colour,
        snapshot_price: price,
        snapshot_image_url: primaryImage,
        quantity: item.quantity,
      };
    });

    // Apply coupon (server-authoritative — the client-side discount is display only).
    let discount = 0;
    let appliedCoupon: { id: string; code: string } | null = null;
    if (dto.coupon_code) {
      const result = await this.coupons.validate({ code: dto.coupon_code, order_value: subtotal });
      discount = Math.min(result.discount, subtotal);
      appliedCoupon = { id: result.coupon_id, code: result.code };
    }

    // All money is in paise (matches the storefront + Razorpay).
    // Free shipping over ₹999; otherwise ₹49 shipping. COD adds a ₹49 fee.
    const shipping = subtotal >= 99900 ? 0 : 4900;
    const cod_fee = paymentMethod === 'cod' ? 4900 : 0;
    const total = Math.max(0, subtotal - discount) + shipping + cod_fee;

    // Create order
    const { data: order, error } = await this.db.client
      .from('orders')
      .insert({
        order_number: this.generateOrderNumber(),
        user_id: userId || null,
        guest_phone: dto.guest_phone || null,
        guest_email: dto.guest_email || null,
        subtotal,
        shipping: shipping + cod_fee,
        discount,
        total,
        coupon_id: appliedCoupon?.id || null,
        coupon_code: appliedCoupon?.code || null,
        address_snapshot: addressSnapshot,
        payment_method: paymentMethod,
        payment_status: 'pending',
        notes: dto.notes || null,
      })
      .select()
      .single();

    if (error) throw error;

    // Insert order items
    await this.db.client.from('order_items').insert(
      orderItems.map(item => ({ ...item, order_id: order.id }))
    );

    // Reduce stock.
    // COD orders are committed immediately, so we deduct now.
    // Razorpay (online) orders deduct stock ONLY on payment.captured (see
    // PaymentsService.handleWebhook) — otherwise abandoned/failed online orders
    // would permanently consume inventory with no real purchase.
    if (paymentMethod === 'cod') {
      for (const item of cartItems as any[]) {
        await this.db.client
          .from('product_variants')
          .update({ stock: item.product_variants.stock - item.quantity })
          .eq('id', item.product_variants.id);
      }
    }

    // Clear cart
    await this.db.client.from('cart_items').delete().eq('cart_id', cart.id);

    // Record coupon redemption (bumps used_count + logs to coupon_uses).
    if (appliedCoupon) {
      await this.coupons.redeem(appliedCoupon.id, order.id, userId);
    }

    // Send confirmation email for COD (Razorpay orders are confirmed via webhook).
    if (paymentMethod === 'cod') {
      let recipientEmail = dto.guest_email;
      if (!recipientEmail && userId) {
        const { data: u } = await this.db.client
          .from('users').select('email').eq('id', userId).single();
        recipientEmail = u?.email || undefined;
      }
      if (recipientEmail) {
        await this.email.sendOrderConfirmation(recipientEmail, {
          customer_name: addressSnapshot.name,
          order_id: order.order_number,
          total,
          items: orderItems.map((it) => ({
            name: it.snapshot_name,
            quantity: it.quantity,
            price: it.snapshot_price,
          })),
        });
      }
    }

    return order;
  }

  async findAll(userId?: string, page = 1, limit = 10) {
    const from = (page - 1) * limit;
    let q = this.db.client
      .from('orders')
      .select('*, order_items(*)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (userId) q = q.eq('user_id', userId);

    const { data, error, count } = await q;
    if (error) throw error;
    return { data, meta: { total: count, page, limit } };
  }

  async findOne(id: string, user?: { id: string; role: string }) {
    const { data, error } = await this.db.client
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', id)
      .single();
    if (error || !data) throw new NotFoundException('Order not found');

    // Ownership enforcement (Supabase uses the service key, so RLS is bypassed —
    // authorization MUST be enforced here). Admins may view any order; a regular
    // user may only view their own. Return 404 (not 403) to avoid leaking existence.
    const isAdmin = user?.role === 'admin';
    if (!isAdmin && data.user_id !== user?.id) {
      throw new NotFoundException('Order not found');
    }
    return data;
  }

  async updateStatus(id: string, dto: UpdateOrderStatusDto, adminEmail?: string) {
    const { data: order } = await this.db.client
      .from('orders').select('*, users(email, name)').eq('id', id).single();
    if (!order) throw new NotFoundException('Order not found');

    await this.db.client.from('orders').update({ status: dto.status }).eq('id', id);

    // Send ship email
    if (dto.status === 'shipped' && dto.tracking_number) {
      const userEmail = (order.users as any)?.email;
      if (userEmail) {
        await this.email.sendOrderShipped(userEmail, {
          customer_name: (order.users as any)?.name || 'Customer',
          order_id: order.order_number,
          tracking_number: dto.tracking_number,
          courier_name: dto.courier_name || 'Courier',
        });
      }
    }

    return { message: 'Status updated' };
  }

  /**
   * Printable HTML invoice (GST breakdown) for an order. Ownership is enforced:
   * a customer sees only their own orders; admins see any.
   *
   * GST is computed INCLUSIVE (Indian retail prices already include tax). Seller
   * details and the rate come from env so nothing tax-related is hard-coded:
   *   SELLER_NAME, SELLER_ADDRESS, SELLER_GSTIN, SELLER_STATE, GST_RATE (e.g. 5).
   * Intra-state (buyer state == seller state) splits into CGST+SGST; otherwise
   * IGST. Confirm the rate / HSN codes with your accountant before relying on it.
   */
  async getInvoice(id: string, user?: { id: string; role: string }): Promise<string> {
    const { data: order } = await this.db.client
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', id)
      .single();
    if (!order) throw new NotFoundException('Order not found');

    const isAdmin = user?.role === 'admin';
    if (!isAdmin && order.user_id !== user?.id) {
      throw new NotFoundException('Order not found');
    }

    const money = (paise: number) => `₹${(Math.round(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Seller / GST details come from admin-editable settings (Settings page),
    // not env — so they can be changed without a redeploy.
    const settings = await this.settings.get();
    const sellerName = settings.seller_name || 'KALOKEA';
    const sellerAddress = settings.seller_address || '';
    const sellerGstin = settings.seller_gstin || '';
    const sellerState = (settings.seller_state || '').toLowerCase();
    const gstRate = Number(settings.gst_rate) || 5;

    const addr = order.address_snapshot || {};
    const buyerState = String(addr.state || '').toLowerCase();
    const intraState = !!sellerState && sellerState === buyerState;

    // Inclusive GST on the taxable goods value (subtotal less discount).
    const taxable = Math.max(0, (order.subtotal || 0) - (order.discount || 0));
    const netValue = Math.round(taxable / (1 + gstRate / 100));
    const taxAmount = taxable - netValue;
    const cgst = intraState ? Math.round(taxAmount / 2) : 0;
    const sgst = intraState ? taxAmount - cgst : 0;
    const igst = intraState ? 0 : taxAmount;

    const rows = (order.order_items || [])
      .map(
        (it: any) => `
        <tr>
          <td>${esc(it.snapshot_name)}${it.snapshot_size ? ` (${esc(it.snapshot_size)})` : ''}</td>
          <td style="text-align:center">${it.quantity}</td>
          <td style="text-align:right">${money(it.snapshot_price)}</td>
          <td style="text-align:right">${money(it.snapshot_price * it.quantity)}</td>
        </tr>`,
      )
      .join('');

    const taxRows = intraState
      ? `<tr><td>CGST (${(gstRate / 2).toFixed(2)}%)</td><td style="text-align:right">${money(cgst)}</td></tr>
         <tr><td>SGST (${(gstRate / 2).toFixed(2)}%)</td><td style="text-align:right">${money(sgst)}</td></tr>`
      : `<tr><td>IGST (${gstRate.toFixed(2)}%)</td><td style="text-align:right">${money(igst)}</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Invoice ${esc(order.order_number)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#0a0a0a;max-width:760px;margin:0 auto;padding:32px;font-size:13px;}
  h1{font-family:Georgia,serif;letter-spacing:4px;margin:0;}
  .muted{color:#6b6b6b;}
  table{width:100%;border-collapse:collapse;margin:18px 0;}
  th,td{padding:8px 10px;border-bottom:1px solid #e8e4e0;text-align:left;}
  th{background:#faf8f5;font-size:11px;text-transform:uppercase;letter-spacing:1px;}
  .totals{width:280px;margin-left:auto;}
  .totals td{border:none;padding:4px 10px;}
  .grand{font-weight:bold;border-top:2px solid #0a0a0a;}
  @media print{body{padding:0;}}
</style></head>
<body onload="window.focus()">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0a0a0a;padding-bottom:16px;">
    <div><h1>KALOKEA</h1><p class="muted" style="margin:4px 0 0;">Tax Invoice</p></div>
    <div style="text-align:right" class="muted">
      <div><strong style="color:#0a0a0a">${esc(order.order_number)}</strong></div>
      <div>${new Date(order.created_at).toLocaleDateString('en-IN')}</div>
    </div>
  </div>

  <div style="display:flex;justify-content:space-between;margin-top:18px;gap:24px;">
    <div>
      <p style="margin:0 0 4px;"><strong>Sold by</strong></p>
      <p class="muted" style="margin:0;">${esc(sellerName)}</p>
      ${sellerAddress ? `<p class="muted" style="margin:0;">${esc(sellerAddress)}</p>` : ''}
      ${sellerGstin ? `<p class="muted" style="margin:0;">GSTIN: ${esc(sellerGstin)}</p>` : ''}
    </div>
    <div style="text-align:right">
      <p style="margin:0 0 4px;"><strong>Billed to</strong></p>
      <p class="muted" style="margin:0;">${esc(addr.name)}</p>
      <p class="muted" style="margin:0;">${esc(addr.line1)}${addr.line2 ? ', ' + esc(addr.line2) : ''}</p>
      <p class="muted" style="margin:0;">${esc(addr.city)}, ${esc(addr.state)} ${esc(addr.pincode)}</p>
    </div>
  </div>

  <table>
    <thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="totals">
    <tr><td>Taxable value</td><td style="text-align:right">${money(netValue)}</td></tr>
    ${taxRows}
    ${order.discount ? `<tr><td>Discount</td><td style="text-align:right">- ${money(order.discount)}</td></tr>` : ''}
    <tr><td>Shipping</td><td style="text-align:right">${money(order.shipping || 0)}</td></tr>
    <tr class="grand"><td>Total</td><td style="text-align:right">${money(order.total)}</td></tr>
  </table>

  <p class="muted" style="margin-top:24px;font-size:11px;">
    All prices are inclusive of GST. This is a computer-generated invoice.
    To save as PDF, use your browser&rsquo;s Print &rarr; Save as PDF.
  </p>
</body></html>`;
  }
}
