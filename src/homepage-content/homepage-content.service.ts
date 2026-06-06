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
  }> {
    const [cmsResult, catsResult, prodsResult] = await Promise.all([
      this.db.client.from('homepage_content').select('key, value'),
      this.db.client
        .from('categories')
        .select('id, name, slug, image_url, is_active')
        .eq('is_active', true)
        .not('slug', 'in', '("new-arrivals","everything","sale")')
        .order('sort_order', { ascending: true })
        .limit(6),
      this.db.client
        .from('products')
        .select(`
          id, name, slug, base_price, compare_price, is_featured, tags,
          product_images(url, alt_text, is_primary, sort_order),
          categories(name, slug)
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(8),
    ]);

    const cms: Record<string, string> = {};
    for (const row of cmsResult.data ?? []) {
      cms[row.key] = row.value;
    }

    return {
      cms,
      categories: catsResult.data ?? [],
      featured_products: prodsResult.data ?? [],
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
