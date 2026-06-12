import { Injectable, NotFoundException, BadRequestException, ForbiddenException, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { CouponsService } from '../coupons/coupons.service';
import { SettingsService } from '../settings/settings.service';
import { GstService } from '../gst/gst.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

// Fallback constants — overridden at runtime by store_settings (after migration 007).
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
    private config: ConfigService,
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
    if (!cart) return { cart: null, cartItems: [] };

    const { data: cartItems } = await this.db.client
      .from('cart_items')
      .select(`
        quantity,
        product_variants(id, sku, size, colour, price, stock, is_active,
          products(name, hsn_code, gst_rate, is_active, product_images(url, is_primary)))
      `)
      .eq('cart_id', cart.id);

    return { cart, cartItems: cartItems || [] };
  }

  /**
   * Load cart items from client-provided variant_id+quantity pairs.
   * Used as a fallback when the server cart is missing or empty.
   * Prices are always fetched from the DB — the client only sends IDs.
   */
  private async loadClientItems(clientItems: { variant_id: string; quantity: number }[]) {
    if (!clientItems?.length) return [];
    const variantIds = clientItems.map(i => i.variant_id);
    const { data: variants } = await this.db.client
      .from('product_variants')
      .select('id, sku, size, colour, price, stock, is_active, products(name, hsn_code, gst_rate, is_active, product_images(url, is_primary))')
      .in('id', variantIds);

    if (!variants?.length) throw new BadRequestException('None of the cart items could be found. Please re-add them.');

    return clientItems.map(ci => {
      const variant = variants.find(v => v.id === ci.variant_id);
      if (!variant) return null;
      return { quantity: ci.quantity, product_variants: variant };
    }).filter(Boolean);
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
    /** variant_id → soft-reserved qty. Passed for Razorpay orders so concurrent
     *  checkouts can't double-sell the last unit before payment is captured. */
    softReservations?: Map<string, number>;
  }) {
    const { cartItems, discount, paymentMethod, buyerState, checkStock, softReservations } = params;
    const settings = await this.settings.get();
    const defaultRate = Number(settings.gst_rate) || 0;
    const intraState = this.gst.isIntraState(buyerState, settings.seller_state);

    // 1. Pre-tax line subtotals.
    let subtotal = 0;
    const lines = cartItems.map((item: any) => {
      const variant = item.product_variants;
      const product = variant.products;

      // Block orders for products/variants that have been deactivated (NH-2).
      if (product?.is_active === false || variant?.is_active === false) {
        throw new BadRequestException(
          `"${product?.name || 'An item'}" is no longer available. Please remove it from your cart.`,
        );
      }

      if (checkStock) {
        const softReserved = softReservations?.get(variant.id) ?? 0;
        const available = (variant.stock ?? 0) - softReserved;
        if (available < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for ${product?.name || 'item'}${variant.size ? ` (${variant.size})` : ''}`,
          );
        }
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
    // Reuse the settings already fetched above (avoid a second round-trip).
    const freeThreshold = settings?.shipping_free_threshold ?? SHIPPING_FREE_THRESHOLD;
    const shippingFee   = settings?.shipping_fee ?? SHIPPING_FEE;
    const codFeeAmount  = settings?.cod_fee ?? COD_FEE;
    const shipping = subtotal >= freeThreshold ? 0 : shippingFee;
    const codFee = paymentMethod === 'cod' ? codFeeAmount : 0;
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
        const result = await this.coupons.validate({ code: dto.coupon_code, order_value: subtotalRaw, user_id: userId });
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
    const { cart, cartItems: serverItems } = await this.loadCart(userId, dto.session_id);

    // Use server cart if it has items; otherwise fall back to client-provided items.
    let cartItems = serverItems;
    if (!cartItems.length && dto.cart_items?.length) {
      cartItems = await this.loadClientItems(dto.cart_items) as any[];
    }
    if (!cartItems.length) {
      throw new BadRequestException(
        'Your cart is empty. Please add items before placing an order.'
      );
    }

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

    // Guest orders must include an email — needed for order confirmation,
    // shipping updates, and invoice access (GET /orders/:id/invoice?guest_email=).
    if (!userId && !dto.guest_email) {
      throw new BadRequestException('Email address is required to place an order as a guest');
    }

    const paymentMethod = dto.payment_method === 'cod' ? 'cod' : 'razorpay';

    // Server-authoritative coupon (client discount is display-only).
    let discount = 0;
    let appliedCoupon: { id: string; code: string } | null = null;
    if (dto.coupon_code) {
      const subtotalRaw = cartItems.reduce(
        (s: number, it: any) => s + it.product_variants.price * it.quantity, 0);
      const result = await this.coupons.validate({ code: dto.coupon_code, order_value: subtotalRaw, user_id: userId });
      discount = result.discount;
      appliedCoupon = { id: result.coupon_id, code: result.code };
    }

    // For Razorpay orders: load current soft-reservations so two concurrent
    // checkouts for the last unit both see the first one's hold and one fails
    // cleanly with "insufficient stock" instead of both succeeding.
    const softReservations = new Map<string, number>();
    if (paymentMethod === 'razorpay') {
      // Opportunistically clean up expired reservations (fire-and-forget).
      Promise.resolve(this.db.client.rpc('expire_stock_reservations')).catch(() => {});
      for (const item of cartItems) {
        const variantId = (item.product_variants as any)?.id;
        if (variantId) {
          const { data: count } = await this.db.client
            .rpc('get_soft_reserved', { p_variant_id: variantId });
          softReservations.set(variantId, Number(count) || 0);
        }
      }
    }

    const b = await this.computeBreakdown({
      cartItems,
      discount,
      paymentMethod,
      buyerState: addressSnapshot.state,
      checkStock: true,
      softReservations,
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
    if (error) { await rollbackStock(); throw new InternalServerErrorException(error.message || 'Failed to create order'); }

    const { error: itemsError } = await this.db.client.from('order_items').insert(
      b.orderItems.map((item) => ({ ...item, order_id: order.id })),
    );
    // Items failed — remove the orphan order header and release stock.
    if (itemsError) {
      await this.db.client.from('orders').delete().eq('id', order.id);
      await rollbackStock();
      throw new InternalServerErrorException(itemsError.message || 'Failed to save order items');
    }

    // cart may be null when client_items fallback was used (no server cart existed).
    if (cart?.id) {
      await this.db.client.from('cart_items').delete().eq('cart_id', cart.id);
    }

    if (appliedCoupon) {
      // Pass guest_email so per-user cap enforcement works for guest checkout.
      await this.coupons.redeem(appliedCoupon.id, order.id, userId, dto.guest_email);
    }

    // COD is a committed sale → confirmation + receipt + invoice email and GST
    // ledger now. Razorpay does both on payment.captured (webhook).
    if (paymentMethod === 'cod') {
      await this.gst.postSaleLedger(order.id);
      await this.sendConfirmationEmails(order.id);
    }

    // Razorpay: create soft-reservations (TTL 15 min). These hold the units so
    // a concurrent buyer can't grab them while payment is in-flight. Confirmed
    // on payment.captured, deleted on payment.failed or TTL expiry.
    if (paymentMethod === 'razorpay') {
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      Promise.resolve(
        this.db.client.from('stock_reservations').insert(
          b.orderItems.map((item) => ({
            order_id: order.id,
            variant_id: item.variant_id,
            quantity: item.quantity,
            expires_at: expiresAt,
            confirmed: false,
          })),
        ),
      ).catch((e: any) => {
        // If migration 008 hasn't been run yet, log and continue — non-fatal.
        this.logger.warn(`Stock reservation insert failed (run migration 008): ${e?.message}`);
      });
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
        order_db_id: order.id,
        total: Number(order.total) || 0,
        items,
        address: {
          name: addr.name,
          line1: addr.line1 || addr.street,
          line2: addr.line2,
          city: addr.city,
          state: addr.state,
          pincode: addr.pincode,
        },
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

  /**
   * Cancel an order within the 12-hour window.
   * Rules:
   *  - Only the order owner can cancel.
   *  - Order must be in fulfillment_status = 'pending'.
   *  - Order must have been placed within the last 12 hours.
   *  - On cancel: restore stock, trigger Razorpay refund if payment_status = 'paid'.
   */
  async cancelOrder(id: string, userId: string): Promise<{ message: string }> {
    const { data: order } = await this.db.client
      .from('orders')
      .select('*, order_items(*), users(email, name)')
      .eq('id', id)
      .single();

    if (!order) throw new NotFoundException('Order not found');

    // Ownership check
    if (order.user_id !== userId) {
      throw new ForbiddenException('Order not found');
    }

    // Status check: block if EITHER status has progressed past pending.
    // (Using && was a bug — a shipped order could bypass the guard if one field
    // hadn't been updated yet.)
    if (order.fulfillment_status !== 'pending' || order.status !== 'pending') {
      throw new ForbiddenException(
        'Cancellation window has closed. Orders can only be cancelled within 12 hours of placement.',
      );
    }

    // 12-hour window check
    const placedAt = new Date(order.created_at).getTime();
    const twelveHoursMs = 12 * 60 * 60 * 1000;
    if (Date.now() - placedAt > twelveHoursMs) {
      throw new ForbiddenException(
        'Cancellation window has closed. Orders can only be cancelled within 12 hours of placement.',
      );
    }

    // Mark as cancelled
    await this.db.client
      .from('orders')
      .update({ status: 'cancelled', fulfillment_status: 'cancelled' })
      .eq('id', id);

    // Release any pending stock reservations immediately (don't wait for the 15-min cron).
    // This restores availability to other buyers the moment the customer cancels.
    await this.db.client
      .from('stock_reservations')
      .delete()
      .eq('order_id', id);

    // Only restock if stock was actually committed:
    // - COD orders: stock decremented at order creation time
    // - Razorpay/online orders: stock decremented ONLY when payment.captured webhook fires
    // An abandoned/unpaid Razorpay order that is cancelled must NOT call restock_variant
    // because doing so inflates stock counts for inventory that was never decremented.
    const stockWasDeducted =
      order.payment_method === 'cod' || order.payment_status === 'paid';

    if (stockWasDeducted) {
      const items: any[] = order.order_items || [];
      for (const item of items) {
        const { error: restockErr } = await this.db.client.rpc('restock_variant', {
          p_variant_id: item.variant_id,
          p_qty: item.quantity,
        });
        if (restockErr) {
          this.logger.warn(`Stock restore failed for variant ${item.variant_id}: ${restockErr.message}`);
        }
      }
    }

    // Trigger Razorpay refund if order was paid online
    if (order.payment_status === 'paid' && order.payment_method !== 'cod' && order.razorpay_payment_id) {
      const keyId = this.config.get<string>('RAZORPAY_KEY_ID');
      const keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET');
      if (keyId && keySecret) {
        const refundRes = await fetch(
          `https://api.razorpay.com/v1/payments/${order.razorpay_payment_id}/refund`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
            },
            body: JSON.stringify({ amount: Math.round(order.total) }),
          },
        );
        const refundResult: any = await refundRes.json();
        if (!refundRes.ok) {
          this.logger.error(`Razorpay refund failed on cancel: ${JSON.stringify(refundResult)}`);
        } else {
          await this.db.client
            .from('orders')
            .update({ payment_status: 'refunded' })
            .eq('id', id);
        }
      }
    }

    // Send cancellation email
    const recipientEmail = order.guest_email || (order.users as any)?.email;
    const customerName = (order.users as any)?.name || (order.address_snapshot as any)?.name || 'Customer';
    if (recipientEmail) {
      await this.email.sendOrderCancellation(recipientEmail, {
        customer_name: customerName,
        order_id: order.order_number,
        total: Number(order.total) || 0,
      }).catch(() => {});
    }

    return { message: 'Order cancelled successfully' };
  }

  async findAll(userId?: string, page = 1, limit = 10, status?: string, search?: string) {
    const from = (page - 1) * limit;
    // Admin fetch joins users so the order list can show customer names/emails.
    const selectCols = userId
      ? '*, order_items(*)'
      : '*, order_items(*), users(name, email)';
    let q = this.db.client
      .from('orders')
      .select(selectCols, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (userId) q = q.eq('user_id', userId);
    if (status) q = q.eq('status', status);
    if (search) {
      const s = search.replace(/'/g, "''"); // escape single quotes
      q = (q as any).or(
        `order_number.ilike.%${s}%,guest_email.ilike.%${s}%`,
      );
    }

    const { data, error, count } = await q;
    if (error) throw error;
    return { data, meta: { total: count, page, limit } };
  }

  async findOne(id: string, user?: { id: string; role: string }, guestEmail?: string) {
    const { data, error } = await this.db.client
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', id)
      .single();
    if (error || !data) throw new NotFoundException('Order not found');

    const isAdmin = user?.role === 'admin';
    const isOwner = user?.id && data.user_id === user.id;
    const isGuestOwner =
      guestEmail &&
      data.guest_email &&
      data.guest_email.toLowerCase() === guestEmail.toLowerCase();

    if (!isAdmin && !isOwner && !isGuestOwner) {
      throw new NotFoundException('Order not found');
    }
    return data;
  }

  async updateStatus(id: string, dto: UpdateOrderStatusDto, adminEmail?: string) {
    // Include guest_email so guest orders receive status emails too (LB1 fix)
    const { data: order } = await this.db.client
      .from('orders').select('*, guest_email, users(email, name)').eq('id', id).single();
    if (!order) throw new NotFoundException('Order not found');

    // Sync fulfillment_status for statuses that map 1:1.
    const fulfillmentMap: Record<string, string> = {
      shipped: 'shipped',
      delivered: 'delivered',
      cancelled: 'cancelled',
    };
    const fulfillmentUpdate: Record<string, string> = { status: dto.status };
    if (fulfillmentMap[dto.status]) {
      fulfillmentUpdate.fulfillment_status = fulfillmentMap[dto.status];
    }
    await this.db.client.from('orders').update(fulfillmentUpdate).eq('id', id);

    // Resolve email for both logged-in users AND guests
    const userEmail = order.guest_email || (order.users as any)?.email;
    const customerName = (order.users as any)?.name || 'Customer';

    if (dto.status === 'processing') {
      if (userEmail) {
        await this.email.sendOrderProcessing(userEmail, {
          customer_name: customerName,
          order_id: order.order_number,
        }).catch(() => {});
      }
    }

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

    if (dto.status === 'delivered') {
      if (userEmail) {
        await this.email.sendOrderDelivered(userEmail, {
          customer_name: customerName,
          order_id: order.order_number,
          order_db_id: id,
        }).catch(() => {});
      }
    }

    // Admin cancel: release stock reservations, restock if inventory was
    // committed, trigger Razorpay refund if the order was paid online.
    if (dto.status === 'cancelled') {
      await this.db.client.from('stock_reservations').delete().eq('order_id', id);

      const stockWasDeducted =
        order.payment_method === 'cod' || order.payment_status === 'paid';

      if (stockWasDeducted) {
        const { data: orderItems } = await this.db.client
          .from('order_items').select('variant_id, quantity').eq('order_id', id);
        for (const item of orderItems || []) {
          const { error: restockErr } = await this.db.client.rpc('restock_variant', {
            p_variant_id: item.variant_id,
            p_qty: item.quantity,
          });
          if (restockErr) {
            this.logger.warn(`Admin cancel: stock restore failed for variant ${item.variant_id}: ${restockErr.message}`);
          }
        }
      }

      if (order.payment_status === 'paid' && order.payment_method !== 'cod' && order.razorpay_payment_id) {
        const keyId = this.config.get<string>('RAZORPAY_KEY_ID');
        const keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET');
        if (keyId && keySecret) {
          const refundRes = await fetch(
            `https://api.razorpay.com/v1/payments/${order.razorpay_payment_id}/refund`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
              },
              body: JSON.stringify({ amount: Math.round(order.total) }),
            },
          );
          const refundResult: any = await refundRes.json();
          if (!refundRes.ok) {
            this.logger.error(`Admin cancel Razorpay refund failed: ${JSON.stringify(refundResult)}`);
          } else {
            await this.db.client.from('orders').update({ payment_status: 'refunded' }).eq('id', id);
          }
        }
      }

      if (userEmail) {
        await this.email.sendOrderCancellation(userEmail, {
          customer_name: customerName,
          order_id: order.order_number,
          total: Number(order.total) || 0,
        }).catch(() => {});
      }
    }

    return { message: 'Status updated' };
  }

  /**
   * Printable HTML tax invoice. GST is EXCLUSIVE and read from the order's
   * persisted snapshot (taxable_value / cgst / sgst / igst / total_gst), so a
   * historical invoice never changes if the store rate later changes. Seller
   * details come from admin Settings. Ownership enforced (customer = own only).
   */
  /**
   * Public guest order tracking — returns minimal order status data.
   * Requires order_number + the email used at checkout to prove ownership.
   */
  async trackGuestOrder(orderNumber: string, email: string): Promise<object> {
    if (!orderNumber || !email) {
      throw new NotFoundException('Order not found');
    }
    const { data: order } = await this.db.client
      .from('orders')
      .select('id, order_number, status, fulfillment_status, payment_status, payment_method, total, created_at, guest_email, awb_code, courier_name, shiprocket_status, order_items(quantity, snapshot_price, snapshot_name, snapshot_size, snapshot_colour)')
      .eq('order_number', orderNumber.toUpperCase())
      .single();

    if (!order) throw new NotFoundException('Order not found');

    // Ownership: email must match guest_email stored at checkout
    const emailMatch =
      order.guest_email &&
      order.guest_email.toLowerCase() === email.toLowerCase();

    if (!emailMatch) throw new NotFoundException('Order not found');

    // Return only safe public fields — never expose internal IDs or full address
    return {
      order_number:       order.order_number,
      status:             order.status,
      fulfillment_status: order.fulfillment_status,
      payment_status:     order.payment_status,
      payment_method:     order.payment_method,
      total:              order.total,
      created_at:         order.created_at,
      // ShipRocket tracking (only surfaced when AWB exists)
      awb_code:           order.awb_code       || null,
      courier_name:       order.courier_name   || null,
      shiprocket_status:  order.shiprocket_status || null,
      items: (order.order_items || []).map((it: any) => ({
        product_name:  it.snapshot_name,
        variant_label: [it.snapshot_size, it.snapshot_colour].filter(Boolean).join(' / ') || null,
        quantity:      it.quantity,
        unit_price:    it.snapshot_price,
      })),
    };
  }

  async getInvoice(id: string, user?: { id: string; role: string }, guestEmail?: string): Promise<string> {
    const { data: order } = await this.db.client
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', id)
      .single();
    if (!order) throw new NotFoundException('Order not found');

    const isAdmin = user?.role === 'admin';
    const isOwner = user?.id && order.user_id === user.id;
    // Guests can access their invoice by providing the email used at checkout.
    const isGuestOwner =
      !order.user_id &&
      guestEmail &&
      order.guest_email &&
      order.guest_email.toLowerCase() === guestEmail.toLowerCase();

    if (!isAdmin && !isOwner && !isGuestOwner) {
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

  // ── Admin CSV export ───────────────────────────────────────────────────────

  /**
   * Export all orders (or a filtered subset) as CSV. Includes one row per
   * order_item so every line has product details. Opens cleanly in Excel (UTF-8 BOM).
   */
  async exportOrdersCsv(filters: {
    status?: string;
    from?: string;
    to?: string;
  } = {}): Promise<string> {
    let q = this.db.client
      .from('orders')
      .select(`
        id, order_number, status, payment_status, payment_method,
        total, taxable_value, total_gst, shipping,
        coupon_code, discount,
        address_snapshot, company_name, gstin,
        guest_email,
        created_at,
        users(name, email),
        order_items(quantity, snapshot_price, snapshot_name, snapshot_sku)
      `)
      .order('created_at', { ascending: false });

    if (filters.status) q = q.eq('status', filters.status);
    if (filters.from)   q = q.gte('created_at', filters.from);
    if (filters.to)     q = q.lte('created_at', filters.to);

    const { data } = await q;
    const rows = data || [];

    const header = 'order_number,status,payment_status,payment_method,total,customer_name,customer_email,coupon_code,discount,created_at';
    const lines = rows.map((o: any) => [
      o.order_number,
      o.status,
      o.payment_status || '',
      o.payment_method || '',
      (o.total / 100).toFixed(2),
      (o.users as any)?.name || o.guest_email || '',
      (o.users as any)?.email || o.guest_email || '',
      o.coupon_code || '',
      o.discount ? (o.discount / 100).toFixed(2) : '0',
      new Date(o.created_at).toISOString(),
    ].map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    return [header, ...lines].join('\n');
  }
}
