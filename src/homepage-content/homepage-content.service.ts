import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class HomepageContentService {
  constructor(private db: DatabaseService) {}

  /** Returns all homepage content as a flat key→value object. */
  async getAll(): Promise<Record<string, string>> {
    const { data, error } = await this.db.client
      .from('homepage_content')
      .select('key, value');
    if (error) throw error;
    const result: Record<string, string> = {};
    for (const row of data ?? []) {
      result[row.key] = row.value;
    }
    return result;
  }

  /**
   * Aggregated homepage payload — returns CMS content + categories + 8 newest
   * products in one round-trip. Replaces 4 separate API calls from the frontend.
   */
  async getHomepageData(): Promise<{
    cms: Record<string, string>;
    categories: any[];
    featured_products: any[];
    bestsellers: any[];
  }> {
    // Shared product projection — keep featured + bestseller selects identical.
    // MUST include product_variants (ProductCard computes in/out-of-stock from
    // them) and avg_rating/review_count (so cards show star ratings).
    const productSelect = `
          id, name, slug, base_price, compare_price, is_featured, tags, avg_rating, review_count,
          product_images(url, alt_text, is_primary, sort_order),
          product_variants(id, size, colour, price, stock, sku, is_active),
          categories(name, slug)
        `;
    const [cmsResult, catsResult, prodsResult, bestResult] = await Promise.all([
      this.db.client.from('homepage_content').select('key, value'),
      this.db.client
        .from('categories')
        .select('id, name, slug, image_url, is_active')
        .eq('is_active', true)
        .not('slug', 'in', '("new-arrivals","everything","sale")')
        .order('sort_order', { ascending: true })
        .limit(6),
      // Featured = 8 newest active products.
      this.db.client
        .from('products')
        .select(productSelect)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(8),
      // Bestsellers = admin-promoted (sort_weight) first, then newest.
      this.db.client
        .from('products')
        .select(productSelect)
        .eq('is_active', true)
        .order('sort_weight', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(4),
    ]);

    const cms: Record<string, string> = {};
    for (const row of cmsResult.data ?? []) {
      cms[row.key] = row.value;
    }

    return {
      cms,
      categories: catsResult.data ?? [],
      featured_products: prodsResult.data ?? [],
      bestsellers: bestResult.data ?? [],
    };
  }

  /** Upsert a single key. */
  async update(key: string, value: string): Promise<{ key: string; value: string }> {
    const { error } = await this.db.client
      .from('homepage_content')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    return { key, value };
  }
}
