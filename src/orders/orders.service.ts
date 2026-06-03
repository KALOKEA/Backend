import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { CouponsService } from '../coupons/coupons.service';
import { SettingsService } from '../settings/settings.service';
import { GstService } from '../gst/gst.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

const SHIPPING_FREE_THRESHOLD = 99900; // ₹999 (paise)
const SHIPPING_FEE = 4900; // ₹49
const COD_FEE = 4900; // ₹49

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private db: DatabaseService,
    private email: EmailService,
    private coupons: CouponsService,
    private settings: SettingsService,
    private gst: GstService,
  ) {}

  private generateOrderNumber(): string {
    return `KLK-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }

  /** Load the (single) cart for a user or guest session. */
  private async loadCart(userId?: string, sessionId?: string) {
    let cartQuery = this.db.client.from('carts').select('id');
    if (userId) cartQuery = cartQuery.eq('user_id', userId);
    else if (sessionId) cartQuery = cartQuery.eq('session_id', sessionId).is('user_id', null);
    else throw new BadRequestException('User or session required');

    const { data: cart } = await cartQuery.single();
    if (!cart) throw new BadRequestException('Cart not found');

    const { data: cartItems } = await this.db.client
      .from('cart_items')
      .select(`
        quantity,
        product_variants(id, sku, size, colour, price, stock,
          products(name, hsn_code, gst_rate, product_images(url, is_primary)))
      `)
      .eq('cart_id', cart.id);

    if (!cartItems || cartItems.length === 0) throw new BadRequestException('Cart is empty');
    return { cart, cartItems };
  }

  /**
   * Core money + GST engine (EXCLUSIVE model). Builds per-line snapshots with
   * proportional discount allocation, resolves each product's GST rate (per-HSN
   * slab, store default as fallback), and computes the CGST/SGST/IGST split for
   * the buyer's place of supply. Returns everything both createOrder and quote
   * need. No persistence.
   */
  private async computeBreakdown(params: {
    cartItems: any[];
    discount: number;
    paymentMethod: 'cod' | 'razorpay';
    buyerState?: string;
    checkStock?: boolean;
  }) {
    const { cartItems, discount, paymentMethod, buyerState, checkStock } = params;
    const settings = await this.settings.get();
    const defaultRate = Number(settings.gst_rate) || 0;
    const intraState = this.gst.isIntraState(buyerState, settings.seller_state);

    // 1. Pre-tax line subtotals.
    let subtotal = 0;
    const lines = cartItems.map((item: any) => {
      const variant = item.product_variants;
      const product = variant.products;
      if (checkStock && (variant.stock == null || variant.stock < item.quantity)) {
        throw new BadRequestException(
          `Insufficient stock for ${product?.name || 'item'}${variant.size ? ` (${variant.size})` : ''}`,
        );
      }
      const lineSubtotal = variant.price * item.quantity;
      subtotal += lineSubtotal;
      const primaryImage =
        product.product_images?.find((i: any) => i.is_primary)?.url ||
        product.product_images?.[0]?.url;
      return {
        variant,
        product,
        quantity: item.quantity,
        lineSubtotal,
        rate: this.gst.resolveRate(product.gst_rate, defaultRate),
        hsn_code: product.hsn_code || null,
        primaryImage,
      };
    });

    const cappedDiscount = Math.min(discount, subtotal);

    // 2. Allocate the order-level discount across lines (proportional to value),
    //    then compute per-line taxable value + GST (exclusive, added on top).
    let allocated = 0;
    let taxableTotal = 0;
    let gstTotal = 0;
    const orderItems = lines.map((l, idx) => {
      const lineDiscount =
        idx === lines.length - 1
          ? cappedDiscount - allocated
          : subtotal > 0
            ? Math.round((cappedDiscount * l.lineSubtotal) / subtotal)
            : 0;
      if (idx !== lines.length - 1) allocated += lineDiscount;
      const taxable = l.lineSubtotal - lineDiscount;
      const gstAmount = this.gst.taxOn(taxable, l.rate);
      taxableTotal += taxable;
      gstTotal += gstAmount;
      return {
        variant_id: l.variant.id,
        snapshot_name: l.product.name,
        snapshot_sku: l.variant.sku,
        snapshot_size: l.variant.size,
        snapshot_colour: l.variant.colour,
        snapshot_price: l.variant.price,
        snapshot_image_url: l.primaryImage,
        quantity: l.quantity,
        hsn_code: l.hsn_code,
        gst_rate: l.rate,
        taxable_value: taxable,
        gst_amount: gstAmount,
      };
    });

    const { cgst, sgst, igst } = this.gst.splitTax(gstTotal, intraState);
    const shipping = subtotal >= SHIPPING_FREE_THRESHOLD ? 0 : SHIPPING_FEE;
    const codFee = paymentMethod === 'cod' ? COD_FEE : 0;
    // Total = taxable goods value + GST + shipping + COD fee. (Shipping is not
    // taxed here — confirm treatment with your CA if you want GST on freight.)
    const total = taxableTotal + gstTotal + shipping + codFee;

    return {
      orderItems,
      subtotal,
      discount: cappedDiscount,
      taxable_value: taxableTotal,
      total_gst: gstTotal,
      cgst,
      sgst,
      igst,
      gst_rate: defaultRate,
      intraState,
      buyerState: buyerState || null,
      shipping,
      cod_fee: codFee,
      total,
    };
  }

  /**
   * Non-persisting price quote for the checkout summary. Returns the exact
   * GST + totals the customer will be charged, so the displayed tax matches the
   * order. Buyer state (for the CGST/SGST vs IGST split) is taken from the
   * chosen address when available.
   */
  async quote(dto: CreateOrderDto, userId?: string) {
    const { cartItems } = await this.loadCart(userId, dto.session_id);

    let buyerState = dto.address_snapshot?.state;
    if (!buyerState && dto.address_id && userId) {
      const { data: address } = await this.db.client
        .from('addresses').select('state').eq('id', dto.address_id).eq('user_id', userId).single();
      buyerState = address?.state;
    }

    let discount = 0;
    let couponError: string | null = null;
    const subtotalRaw = cartItems.reduce(
      (s: number, it: any) => s + it.product_variants.price * it.quantity, 0);
    if (dto.coupon_code) {
      try {
        const result = await this.coupons.validate({ code: dto.coupon_code, order_value: subtotalRaw });
        discount = result.discount;
      } catch (e: any) {
        couponError = e?.message || 'Invalid coupon';
      }
    }

    const paymentMethod = dto.payment_method === 'cod' ? 'cod' : 'razorpay';
    const b = await this.computeBreakdown({ cartItems, discount, paymentMethod, buyerState });
    return {
      subtotal: b.subtotal,
      discount: b.discount,
      taxable_value: b.taxable_value,
      total_gst: b.total_gst,
      cgst: b.cgst,
      sgst: b.sgst,
      igst: b.igst,
      intra_state: b.intraState,
      place_of_supply: b.buyerState,
      shipping: b.shipping,
      cod_fee: b.cod_fee,
      total: b.total,
      coupon_error: couponError,
    };
  }

  async createOrder(dto: CreateOrderDto, userId?: string) {
    const { cart, cartItems } = await this.loadCart(userId, dto.session_id);

    // Resolve the delivery address into a snapshot. Logged-in users send
    // address_id (loaded + ownership-checked); guests send address_snapshot.
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

    const paymentMethod = dto.payment_method === 'cod' ? 'cod' : 'razorpay';

    // Server-authoritative coupon (client discount is display-only).
    let discount = 0;
    let appliedCoupon: { id: string; code: string } | null = null;
    if (dto.coupon_code) {
      const subtotalRaw = cartItems.reduce(
        (s: number, it: any) => s + it.product_variants.price * it.quantity, 0);
      const result = await this.coupons.validate({ code: dto.coupon_code, order_value: subtotalRaw });
      discount = result.discount;
      appliedCoupon = { id: result.coupon_id, code: result.code };
    }

    const b = await this.computeBreakdown({
      cartItems,
      discount,
      paymentMethod,
      buyerState: addressSnapshot.state,
      checkStock: true,
    });

    const wantsGstInvoice = !!dto.gst_invoice && !!dto.gstin;

    // COD is a committed sale, so reserve stock ATOMICALLY before creating the
    // order. decrement_stock only succeeds if enough is in stock, so concurrent
    // checkouts can't oversell the last unit. If any line fails, restock what
    // we already took and abort — nothing is persisted. (Razorpay reserves at
    // payment.captured instead, so abandoned online orders don't hold stock.)
    const reserved: Array<{ id: string; qty: number }> = [];
    const rollbackStock = async () => {
      for (const r of reserved) {
        await this.db.client.rpc('restock_variant', { p_variant_id: r.id, p_qty: r.qty });
      }
    };
    if (paymentMethod === 'cod') {
      for (const item of b.orderItems) {
        const { data: ok, error: decErr } = await this.db.client.rpc('decrement_stock', {
          p_variant_id: item.variant_id,
          p_qty: item.quantity,
        });
        if (decErr || ok !== true) {
          await rollbackStock();
          throw new BadRequestException(`Insufficient stock for ${item.snapshot_name}`);
        }
        reserved.push({ id: item.variant_id, qty: item.quantity });
      }
    }

    // Create order (GST snapshot persisted so invoices/ledger never recompute).
    const { data: order, error } = await this.db.client
      .from('orders')
      .insert({
        order_number: this.generateOrderNumber(),
        user_id: userId || null,
        guest_phone: dto.guest_phone || null,
        guest_email: dto.guest_email || null,
        subtotal: b.subtotal,
        shipping: b.shipping + b.cod_fee,
        discount: b.discount,
        taxable_value: b.taxable_value,
        cgst: b.cgst,
        sgst: b.sgst,
        igst: b.igst,
        total_gst: b.total_gst,
        place_of_supply: addressSnapshot.state || null,
        is_intra_state: b.intraState,
        gstin: wantsGstInvoice ? dto.gstin : null,
        company_name: wantsGstInvoice ? dto.company_name || null : null,
        total: b.total,
        coupon_id: appliedCoupon?.id || null,
        coupon_code: appliedCoupon?.code || null,
        address_snapshot: addressSnapshot,
        payment_method: paymentMethod,
        payment_status: 'pending',
        notes: dto.notes || null,
      })
      .select()
      .single();

    // Order header failed — release any reserved stock so it isn't lost.
    if (error) { await rollbackStock(); throw error; }

    const { error: itemsError } = await this.db.client.from('order_items').insert(
      b.orderItems.map((item) => ({ ...item, order_id: order.id })),
    );
    // Items failed — remove the orphan order header and release stock.
    if (itemsError) {
      await this.db.client.from('orders').delete().eq('id', order.id);
      await rollbackStock();
      throw itemsError;
    }

    await this.db.client.from('cart_items').delete().eq('cart_id', cart.id);

    if (appliedCoupon) {
      await this.coupons.redeem(appliedCoupon.id, order.id, userId);
    }

    // COD is a committed sale → confirmation + receipt + invoice email and GST
    // ledger now. Razorpay does both on payment.captured (webhook).
    if (paymentMethod === 'cod') {
      await this.gst.postSaleLedger(order.id);
      await this.sendConfirmationEmails(order.id);
    }

    return order;
  }

  /**
   * Sends the customer their booking confirmation + GST payment receipt with the
   * tax invoice attached, and alerts the admin. Called once a sale is committed
   * (COD at creation, Razorpay on payment.captured). Email failures never block.
   */
  async sendConfirmationEmails(orderId: string): Promise<void> {
    const { data: order } = await this.db.client
      .from('orders')
      .select('*, users(email, name), order_items(*)')
      .eq('id', orderId)
      .single();
    if (!order) return;

    const addr = order.address_snapshot || {};
    let recipientEmail = order.guest_email || (order.users as any)?.email || undefined;

    const items = (order.order_items || []).map((it: any) => ({
      name: it.snapshot_name,
      quantity: it.quantity,
      price: Number(it.snapshot_price) || 0,
    }));

    if (recipientEmail) {
      let invoiceHtml: string | undefined;
      try { invoiceHtml = await this.renderInvoiceHtml(order); } catch { invoiceHtml = undefined; }

      await this.email.sendOrderConfirmation(recipientEmail, {
        customer_name: order.company_name || addr.name || 'Customer',
        order_id: order.order_number,
        total: Number(order.total) || 0,
        items,
        receipt: {
          subtotal: Number(order.subtotal) || 0,
          discount: Number(order.discount) || 0,
          taxable_value: Number(order.taxable_value) || 0,
          cgst: Number(order.cgst) || 0,
          sgst: Number(order.sgst) || 0,
          igst: Number(order.igst) || 0,
          total_gst: Number(order.total_gst) || 0,
          shipping: Number(order.shipping) || 0,
          is_intra_state: !!order.is_intra_state,
          payment_method: order.payment_method === 'cod' ? 'Cash on Delivery' : 'Razorpay (prepaid)',
        },
        invoice_html: invoiceHtml,
      });
    }

    await this.email.sendAdminNewOrder({
      order_id: order.order_number,
      customer_name: (order.users as any)?.name || order.company_name || addr.name || order.guest_phone || 'Guest',
      total: Number(order.total) || 0,
      items_count: items.length,
      payment_method: order.payment_method === 'cod' ? 'COD' : 'Razorpay',
    });
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

    const userEmail = (order.users as any)?.email;
    const customerName = (order.users as any)?.name || 'Customer';

    if (dto.status === 'shipped' && dto.tracking_number) {
      if (userEmail) {
        await this.email.sendOrderShipped(userEmail, {
          customer_name: customerName,
          order_id: order.order_number,
          tracking_number: dto.tracking_number,
          courier_name: dto.courier_name || 'Courier',
        }).catch(() => {});
      }
    }

    if (dto.status === 'delivered' && userEmail) {
      await this.email.sendOrderDelivered(userEmail, {
        customer_name: customerName,
        order_id: order.order_number,
        order_db_id: id,
      }).catch(() => {});
    }

    return { message: 'Status updated' };
  }

  /**
   * Printable HTML tax invoice. GST is EXCLUSIVE and read from the order's
   * persisted snapshot (taxable_value / cgst / sgst / igst / total_gst), so a
   * historical invoice never changes if the store rate later changes. Seller
   * details come from admin Settings. Ownership enforced (customer = own only).
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
    return this.renderInvoiceHtml(order);
  }

  /** Builds the tax-invoice HTML for an already-loaded order (no auth check).
   *  Used by getInvoice (after ownership) and by the confirmation email. */
  private async renderInvoiceHtml(order: any): Promise<string> {
    const money = (paise: number) =>
      `₹${(Math.round(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const esc = (s: any) =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const settings = await this.settings.get();
    const sellerName = settings.seller_name || 'KALOKEA';
    const sellerAddress = settings.seller_address || '';
    const sellerGstin = settings.seller_gstin || '';

    const addr = order.address_snapshot || {};
    const intraState = !!order.is_intra_state;
    const taxable = Number(order.taxable_value) || 0;
    const totalGst = Number(order.total_gst) || 0;
    const cgst = Number(order.cgst) || 0;
    const sgst = Number(order.sgst) || 0;
    const igst = Number(order.igst) || 0;

    const rows = (order.order_items || [])
      .map((it: any) => {
        const lineGst = Number(it.gst_amount) || 0;
        return `
        <tr>
          <td>${esc(it.snapshot_name)}${it.snapshot_size ? ` (${esc(it.snapshot_size)})` : ''}</td>
          <td style="text-align:center">${esc(it.hsn_code || '-')}</td>
          <td style="text-align:center">${it.quantity}</td>
          <td style="text-align:right">${money(it.snapshot_price)}</td>
          <td style="text-align:center">${Number(it.gst_rate) || 0}%</td>
          <td style="text-align:right">${money(lineGst)}</td>
          <td style="text-align:right">${money((Number(it.taxable_value) || 0) + lineGst)}</td>
        </tr>`;
      })
      .join('');

    const taxRows = intraState
      ? `<tr><td>CGST</td><td style="text-align:right">${money(cgst)}</td></tr>
         <tr><td>SGST</td><td style="text-align:right">${money(sgst)}</td></tr>`
      : `<tr><td>IGST</td><td style="text-align:right">${money(igst)}</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Invoice ${esc(order.order_number)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#0a0a0a;max-width:760px;margin:0 auto;padding:32px;font-size:13px;}
  h1{font-family:Georgia,serif;letter-spacing:4px;margin:0;}
  .muted{color:#6b6b6b;}
  table{width:100%;border-collapse:collapse;margin:18px 0;}
  th,td{padding:8px 10px;border-bottom:1px solid #e8e4e0;text-align:left;}
  th{background:#faf8f5;font-size:11px;text-transform:uppercase;letter-spacing:1px;}
  .totals{width:300px;margin-left:auto;}
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
      <p class="muted" style="margin:0;">${esc(order.company_name || addr.name)}</p>
      <p class="muted" style="margin:0;">${esc(addr.line1)}${addr.line2 ? ', ' + esc(addr.line2) : ''}</p>
      <p class="muted" style="margin:0;">${esc(addr.city)}, ${esc(addr.state)} ${esc(addr.pincode)}</p>
      ${order.gstin ? `<p class="muted" style="margin:0;">GSTIN: ${esc(order.gstin)}</p>` : ''}
    </div>
  </div>

  <table>
    <thead><tr>
      <th>Item</th><th style="text-align:center">HSN</th><th style="text-align:center">Qty</th>
      <th style="text-align:right">Price</th><th style="text-align:center">GST</th>
      <th style="text-align:right">Tax</th><th style="text-align:right">Amount</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="totals">
    <tr><td>Taxable value</td><td style="text-align:right">${money(taxable)}</td></tr>
    ${taxRows}
    <tr><td>Total GST</td><td style="text-align:right">${money(totalGst)}</td></tr>
    ${order.discount ? `<tr><td>Discount</td><td style="text-align:right">- ${money(order.discount)}</td></tr>` : ''}
    <tr><td>Shipping</td><td style="text-align:right">${money(order.shipping || 0)}</td></tr>
    <tr class="grand"><td>Total</td><td style="text-align:right">${money(order.total)}</td></tr>
  </table>

  <p class="muted" style="margin-top:24px;font-size:11px;">
    Prices are exclusive of GST; tax is shown separately above. This is a
    computer-generated invoice. To save as PDF, use your browser&rsquo;s Print &rarr; Save as PDF.
  </p>
</body></html>`;
  }
}
