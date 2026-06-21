import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class FeedService {
  constructor(private db: DatabaseService, private config: ConfigService) {}

  private esc(s: string): string {
    return (s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Google Merchant Center product feed (RSS 2.0 + g: namespace). */
  async googleFeed(): Promise<string> {
    const site = this.config.get('SITE_URL') || 'https://kalokea.com';

    const { data: products } = await this.db.client
      .from('products')
      .select(`
        id, name, slug, description, base_price,
        product_images(url, is_primary),
        product_variants(stock, is_active)
      `)
      .eq('is_active', true);

    const items = (products || [])
      .map((p: any) => {
        const img =
          p.product_images?.find((i: any) => i.is_primary)?.url ||
          p.product_images?.[0]?.url ||
          '';
        const inStock = (p.product_variants || []).some((v: any) => v.is_active && v.stock > 0);
        const price = (Math.round(p.base_price) / 100).toFixed(2);
        const desc = (p.description || p.name || '').slice(0, 5000);
        return `    <item>
      <g:id>${this.esc(p.id)}</g:id>
      <g:title>${this.esc(p.name)}</g:title>
      <g:description>${this.esc(desc)}</g:description>
      <g:link>${site}/product/${this.esc(p.slug)}/</g:link>
      <g:image_link>${this.esc(img)}</g:image_link>
      <g:availability>${inStock ? 'in_stock' : 'out_of_stock'}</g:availability>
      <g:price>${price} INR</g:price>
      <g:brand>KALOKEA</g:brand>
      <g:condition>new</g:condition>
      <g:identifier_exists>no</g:identifier_exists>
    </item>`;
      })
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>KALOKEA</title>
    <link>${site}</link>
    <description>Women's fashion — dresses, tops, co-ords and more.</description>
${items}
  </channel>
</rss>`;
  }
}
