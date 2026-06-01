import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { CouponsService } from '../coupons/coupons.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private db: DatabaseService,
    private email: EmailService,
    private coupons: CouponsService,
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

    // Reduce stock
    for (const item of cartItems as any[]) {
      await this.db.client
        .from('product_variants')
        .update({ stock: item.product_variants.stock - item.quantity })
        .eq('id', item.product_variants.id);
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
          items: `${cartItems.length} item(s)`,
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
}
