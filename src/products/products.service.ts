import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { AddImageDto } from './dto/add-image.dto';

@Injectable()
export class ProductsService {
  constructor(private db: DatabaseService) {}

  async findAll(query: ProductQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Resolve a category slug (sent by the shop UI) to its id. Unknown slug =>
    // empty result rather than ignoring the filter.
    let categoryId = query.category_id;
    if (!categoryId && query.category_slug) {
      const { data: cat } = await this.db.client
        .from('categories').select('id').eq('slug', query.category_slug).single();
      if (!cat) {
        return { data: [], meta: { total: 0, page, limit, total_pages: 0 } };
      }
      categoryId = cat.id;
    }

    // Filtering by size/colour means "products that have a matching variant",
    // which requires an INNER join on product_variants (default embed wouldn't
    // exclude non-matching products).
    const filterByVariant = !!(query.size || query.colour);
    const variantSelect = filterByVariant
      ? 'product_variants!inner(id, size, colour, price, stock, sku, is_active)'
      : 'product_variants(id, size, colour, price, stock, sku, is_active)';

    let q = this.db.client
      .from('products')
      .select(`
        *,
        categories(id, name, slug),
        product_images(url, alt_text, is_primary, sort_order),
        ${variantSelect}
      `, { count: 'exact' })
      .range(from, to);

    if (!query.include_inactive) q = (q as any).eq('is_active', true);

    if (categoryId) q = q.eq('category_id', categoryId);
    if (query.featured === 'true') q = q.eq('is_featured', true);
    if (query.min_price) q = q.gte('base_price', query.min_price);
    if (query.max_price) q = q.lte('base_price', query.max_price);
    if (query.search) q = q.ilike('name', `%${query.search}%`);
    if (query.size) q = q.eq('product_variants.size', query.size);
    if (query.colour) q = q.eq('product_variants.colour', query.colour);

    if (query.sort === 'price_asc') q = q.order('base_price', { ascending: true });
    else if (query.sort === 'price_desc') q = q.order('base_price', { ascending: false });
    else if (query.sort === 'newest') q = q.order('created_at', { ascending: false });
    else q = q.order('created_at', { ascending: false });

    const { data, error, count } = await q;
    if (error) throw error;

    return {
      data,
      meta: {
        total: count,
        page,
        limit,
        total_pages: Math.ceil((count || 0) / limit),
      },
    };
  }

  async findBySlug(slug: string) {
    const { data, error } = await this.db.client
      .from('products')
      .select(`
        *,
        categories(id, name, slug),
        product_images(url, alt_text, is_primary, sort_order),
        product_variants(id, size, colour, price, stock, sku, is_active)
      `)
      .eq('slug', slug)
      .eq('is_active', true)
      .single();
    if (error || !data) throw new NotFoundException('Product not found');
    return data;
  }

  async create(dto: CreateProductDto) {
    const { data, error } = await this.db.client
      .from('products')
      .insert(dto)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, dto: Partial<CreateProductDto>) {
    const { data, error } = await this.db.client
      .from('products')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new NotFoundException('Product not found');
    return data;
  }

  async remove(id: string) {
    const { error } = await this.db.client
      .from('products')
      .update({ is_active: false })
      .eq('id', id);
    if (error) throw error;
    return { message: 'Product deactivated' };
  }

  // ── Product images ─────────────────────────────────────────────────────────

  /** List a product's images (admin), ordered. */
  async listImages(productId: string) {
    const { data } = await this.db.client
      .from('product_images')
      .select('id, url, alt_text, is_primary, sort_order, public_id')
      .eq('product_id', productId)
      .order('is_primary', { ascending: false })
      .order('sort_order', { ascending: true });
    return data || [];
  }

  /** Attach an (already-uploaded, e.g. Cloudinary) image to a product. The
   *  first image added becomes primary automatically. */
  async addImage(productId: string, dto: AddImageDto) {
    const { data: prod } = await this.db.client
      .from('products').select('id').eq('id', productId).single();
    if (!prod) throw new NotFoundException('Product not found');

    const existing = await this.listImages(productId);
    const makePrimary = dto.is_primary || existing.length === 0;

    if (makePrimary) {
      // Only one primary per product.
      await this.db.client
        .from('product_images').update({ is_primary: false }).eq('product_id', productId);
    }

    const { data, error } = await this.db.client
      .from('product_images')
      .insert({
        product_id: productId,
        url: dto.url,
        public_id: dto.public_id || null,
        alt_text: dto.alt_text || null,
        is_primary: makePrimary,
        sort_order: dto.sort_order ?? existing.length,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  /** Make one image the primary, unsetting the others on the same product. */
  async setPrimaryImage(imageId: string) {
    const { data: img } = await this.db.client
      .from('product_images').select('product_id').eq('id', imageId).single();
    if (!img) throw new NotFoundException('Image not found');
    await this.db.client
      .from('product_images').update({ is_primary: false }).eq('product_id', img.product_id);
    const { data, error } = await this.db.client
      .from('product_images').update({ is_primary: true }).eq('id', imageId).select().single();
    if (error) throw error;
    return data;
  }

  async deleteImage(imageId: string) {
    const { error } = await this.db.client
      .from('product_images').delete().eq('id', imageId);
    if (error) throw error;
    return { message: 'Image removed' };
  }

  /** Update image metadata — used for reordering (sort_order) and alt text. */
  async updateImage(imageId: string, dto: { alt_text?: string; sort_order?: number }) {
    const { data, error } = await this.db.client
      .from('product_images')
      .update(dto)
      .eq('id', imageId)
      .select()
      .single();
    if (error || !data) throw new NotFoundException('Image not found');
    return data;
  }
}
