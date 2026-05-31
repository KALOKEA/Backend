import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class WishlistsService {
  constructor(private db: DatabaseService) {}

  async findAll(userId: string) {
    const { data } = await this.db.client
      .from('wishlists')
      .select('*, products(id, name, slug, base_price, product_images(url, is_primary))')
      .eq('user_id', userId)
      .order('added_at', { ascending: false });
    return data || [];
  }

  async add(userId: string, productId: string) {
    const { data, error } = await this.db.client
      .from('wishlists')
      .upsert({ user_id: userId, product_id: productId }, { onConflict: 'user_id,product_id' })
      .select().single();
    if (error) throw error;
    return data;
  }

  async remove(userId: string, productId: string) {
    await this.db.client
      .from('wishlists').delete().eq('user_id', userId).eq('product_id', productId);
    return { message: 'Removed from wishlist' };
  }
}
