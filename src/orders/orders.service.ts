import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private db: DatabaseService,
    private email: EmailService,
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

    // Calculate totals
    let subtotal = 0;
    const orderItems = cartItems.map((item: any) => {
      const variant = item.product_variants;
      const product = variant.products;
      const price = variant.price;
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

    const shipping = subtotal >= 599 ? 0 : 49;
    const cod_fee = dto.payment_method === 'cod' ? 49 : 0;
    const total = subtotal + shipping + cod_fee;

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
        total,
        address_snapshot: dto.address_snapshot,
        payment_method: dto.payment_method,
        payment_status: dto.payment_method === 'cod' ? 'pending' : 'pending',
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

    // Send confirmation email for COD
    if (dto.payment_method === 'cod' && dto.guest_email) {
      await this.email.sendOrderConfirmation(dto.guest_email, {
        customer_name: dto.address_snapshot.name,
        order_id: order.order_number,
        total,
        items: `${cartItems.length} item(s)`,
      });
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

  async findOne(id: string) {
    const { data, error } = await this.db.client
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', id)
      .single();
    if (error || !data) throw new NotFoundException('Order not found');
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
