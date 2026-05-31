import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { MergeCartDto } from './dto/merge-cart.dto';

@Injectable()
export class CartService {
  constructor(private db: DatabaseService) {}

  private async getOrCreateCart(userId?: string, sessionId?: string) {
    if (userId) {
      const { data: existing } = await this.db.client
        .from('carts').select('*').eq('user_id', userId).single();
      if (existing) return existing;
      const { data } = await this.db.client
        .from('carts').insert({ user_id: userId }).select().single();
      return data;
    }
    if (sessionId) {
      const { data: existing } = await this.db.client
        .from('carts').select('*').eq('session_id', sessionId).is('user_id', null).single();
      if (existing) return existing;
      const { data } = await this.db.client
        .from('carts').insert({ session_id: sessionId }).select().single();
      return data;
    }
    throw new BadRequestException('User ID or session ID required');
  }

  async getCart(userId?: string, sessionId?: string) {
    const cart = await this.getOrCreateCart(userId, sessionId);
    const { data: items } = await this.db.client
      .from('cart_items')
      .select(`
        id, quantity, added_at,
        product_variants(
          id, size, colour, price, stock, sku,
          products(id, name, slug, product_images(url, is_primary))
        )
      `)
      .eq('cart_id', cart.id);
    return { cart_id: cart.id, items: items || [] };
  }

  async addItem(dto: AddToCartDto, userId?: string) {
    const cart = await this.getOrCreateCart(userId, dto.session_id);

    // Check variant stock
    const { data: variant } = await this.db.client
      .from('product_variants').select('stock, price').eq('id', dto.variant_id).single();
    if (!variant) throw new NotFoundException('Variant not found');
    if (variant.stock < dto.quantity) throw new BadRequestException('Insufficient stock');

    // Check if already in cart
    const { data: existing } = await this.db.client
      .from('cart_items')
      .select('*').eq('cart_id', cart.id).eq('variant_id', dto.variant_id).single();

    if (existing) {
      const newQty = existing.quantity + dto.quantity;
      if (variant.stock < newQty) throw new BadRequestException('Insufficient stock');
      await this.db.client
        .from('cart_items').update({ quantity: newQty }).eq('id', existing.id);
    } else {
      await this.db.client
        .from('cart_items').insert({ cart_id: cart.id, variant_id: dto.variant_id, quantity: dto.quantity });
    }

    return this.getCart(userId, dto.session_id);
  }

  async updateItem(itemId: string, dto: UpdateCartItemDto, userId?: string, sessionId?: string) {
    if (dto.quantity === 0) {
      await this.db.client.from('cart_items').delete().eq('id', itemId);
    } else {
      await this.db.client.from('cart_items').update({ quantity: dto.quantity }).eq('id', itemId);
    }
    return this.getCart(userId, sessionId);
  }

  async removeItem(itemId: string, userId?: string, sessionId?: string) {
    await this.db.client.from('cart_items').delete().eq('id', itemId);
    return this.getCart(userId, sessionId);
  }

  async clearCart(userId?: string, sessionId?: string) {
    const cart = await this.getOrCreateCart(userId, sessionId);
    await this.db.client.from('cart_items').delete().eq('cart_id', cart.id);
    return { message: 'Cart cleared' };
  }

  async mergeCart(userId: string, dto: MergeCartDto) {
    // Get guest cart
    const { data: guestCart } = await this.db.client
      .from('carts').select('*').eq('session_id', dto.session_id).is('user_id', null).single();
    if (!guestCart) return { message: 'No guest cart found' };

    // Get or create user cart
    const userCart = await this.getOrCreateCart(userId);

    // Get guest items
    const { data: guestItems } = await this.db.client
      .from('cart_items').select('*').eq('cart_id', guestCart.id);

    if (guestItems && guestItems.length > 0) {
      for (const item of guestItems) {
        const { data: existing } = await this.db.client
          .from('cart_items')
          .select('*').eq('cart_id', userCart.id).eq('variant_id', item.variant_id).single();
        if (existing) {
          await this.db.client
            .from('cart_items').update({ quantity: existing.quantity + item.quantity }).eq('id', existing.id);
        } else {
          await this.db.client
            .from('cart_items').insert({ cart_id: userCart.id, variant_id: item.variant_id, quantity: item.quantity });
        }
      }
    }

    // Delete guest cart
    await this.db.client.from('carts').delete().eq('id', guestCart.id);
    return this.getCart(userId);
  }
}
