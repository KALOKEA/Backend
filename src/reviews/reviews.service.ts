import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(
    private db: DatabaseService,
    private email: EmailService,
  ) {}

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
    // Verify purchase (NC-3)
    const { data: verifyRows } = await this.db.client
      .from('orders')
      .select('id, order_items!inner(product_variants!inner(product_id))')
      .eq('user_id', userId)
      .eq('payment_status', 'paid')
      .eq('order_items.product_variants.product_id', dto.product_id)
      .limit(1);

    if (!verifyRows || verifyRows.length === 0) {
      throw new BadRequestException('You can only review products from your verified purchases');
    }

    const { data, error } = await this.db.client
      .from('reviews')
      .insert({ ...dto, user_id: userId })
      .select().single();
    if (error) throw error;
    return data;
  }

  /** Customer: fetch their own submitted reviews (any approval status). */
  async findByUser(userId: string) {
    const { data } = await this.db.client
      .from('reviews')
      .select('*, products(name, slug)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return data || [];
  }

  async findPending() {
    const { data } = await this.db.client
      .from('reviews')
      .select('*, users(name), products(name)')
      .eq('is_approved', false)
      .order('created_at', { ascending: false });
    return data || [];
  }

  async findAll(page = 1, limit = 30) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const { data, count } = await this.db.client
      .from('reviews')
      .select('*, users(name), products(name, slug)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);
    return {
      data: data || [],
      meta: { total: count || 0, page, limit, total_pages: Math.ceil((count || 0) / limit) },
    };
  }

  /** Recompute avg_rating + review_count on the products row after any approval change. */
  private async refreshProductStats(productId: string): Promise<void> {
    const { data } = await this.db.client
      .from('reviews')
      .select('rating')
      .eq('product_id', productId)
      .eq('is_approved', true);
    const rows = data ?? [];
    const count = rows.length;
    const avg = count > 0
      ? Math.round((rows.reduce((s: number, r: any) => s + r.rating, 0) / count) * 10) / 10
      : null;
    await this.db.client
      .from('products')
      .update({ review_count: count, avg_rating: avg })
      .eq('id', productId);
  }

  async approve(id: string) {
    const { data: review } = await this.db.client
      .from('reviews')
      .select('*, users(name, email), products(name, slug)')
      .eq('id', id)
      .single();

    const { data, error } = await this.db.client
      .from('reviews').update({ is_approved: true }).eq('id', id).select().single();
    if (error || !data) throw new NotFoundException('Review not found');

    if (review?.product_id) {
      this.refreshProductStats(review.product_id).catch(() => {});
    }

    const userEmail = (review?.users as any)?.email;
    if (userEmail) {
      this.email.sendReviewApproved(userEmail, {
        customer_name: (review?.users as any)?.name || 'Customer',
        product_name: (review?.products as any)?.name || 'your product',
        product_slug: (review?.products as any)?.slug || '',
      }).catch(() => {});
    }

    return data;
  }

  async reject(id: string) {
    const { data: review } = await this.db.client
      .from('reviews').select('product_id').eq('id', id).single();
    await this.db.client.from('reviews').delete().eq('id', id);
    if (review?.product_id) {
      this.refreshProductStats(review.product_id).catch(() => {});
    }
    return { message: 'Review rejected and deleted' };
  }

  /** Admin reply to a review */
  async replyToReview(id: string, reply: string) {
    const { data, error } = await this.db.client
      .from('reviews')
      .update({ admin_reply: reply, admin_replied_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new NotFoundException('Review not found');
    return data;
  }

  /** Admin flag / unflag a review */
  async flagReview(id: string, flagged: boolean, flagReason?: string) {
    const { data, error } = await this.db.client
      .from('reviews')
      .update({ flagged, flag_reason: flagged ? (flagReason || null) : null })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new NotFoundException('Review not found');
    return data;
  }
}
