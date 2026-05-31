import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private db: DatabaseService) {}

  async findByProduct(productId: string) {
    const { data } = await this.db.client
      .from('reviews')
      .select('*, users(name)')
      .eq('product_id', productId)
      .eq('is_approved', true)
      .order('created_at', { ascending: false });
    return data || [];
  }

  async create(dto: CreateReviewDto, userId: string) {
    // Verify user purchased this product
    if (dto.order_id) {
      const { data: orderItem } = await this.db.client
        .from('order_items')
        .select('id, product_variants(product_id)')
        .eq('order_id', dto.order_id)
        .eq('product_variants.product_id', dto.product_id)
        .single();
      if (!orderItem) throw new BadRequestException('You can only review products you purchased');
    }

    const { data, error } = await this.db.client
      .from('reviews')
      .insert({ ...dto, user_id: userId })
      .select().single();
    if (error) throw error;
    return data;
  }

  async findPending() {
    const { data } = await this.db.client
      .from('reviews')
      .select('*, users(name), products(name)')
      .eq('is_approved', false)
      .order('created_at', { ascending: false });
    return data || [];
  }

  async approve(id: string) {
    const { data, error } = await this.db.client
      .from('reviews').update({ is_approved: true }).eq('id', id).select().single();
    if (error || !data) throw new NotFoundException('Review not found');
    return data;
  }

  async reject(id: string) {
    await this.db.client.from('reviews').delete().eq('id', id);
    return { message: 'Review rejected and deleted' };
  }
}
