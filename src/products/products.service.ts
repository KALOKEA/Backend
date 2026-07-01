import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { AddImageDto } from './dto/add-image.dto';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private db: DatabaseService,
    private config: ConfigService,
  ) {}

  /**
   * Fire the Cloudflare Pages deploy hook so static product pages rebuild
   * automatically after catalog changes. Fire-and-forget — never blocks the
   * API response. Set CLOUDFLARE_DEPLOY_HOOK in Railway env vars to activate.
   * Get the URL from Cloudflare Pages → your project → Settings →
   * Builds & deployments → Deploy Hooks → Add deploy hook.
   */
  private triggerDeploy(): void {
    const hook = this.config.get<string>('CLOUDFLARE_DEPLOY_HOOK');
    if (!hook) return;
    fetch(hook, { method: 'POST' })
      .then(() => this.logger.log('Cloudflare deploy hook fired'))
      .catch((e) => this.logger.warn(`Deploy hook failed: ${e?.message}`));
  }

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
    else if (query.sort === 'bestseller') {
      // Products with sort_weight > 0 (admin-promoted) appear first, then newest
      q = q.order('sort_weight', { ascending: false }).order('created_at', { ascending: false });
    }
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

  async findByIds(ids: string[]) {
    if (!ids.length) return [];
    const { data, error } = await this.db.client
      .from('products')
      .select(`
        *,
        categories(id, name, slug),
        product_images(url, alt_text, is_primary, sort_order),
        product_variants(id, size, colour, price, stock, sku, is_active)
      `)
      .in('id', ids)
      .eq('is_active', true);
    if (error) throw error;
    return data || [];
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
    // Guard: base_price must be a finite number (NaN/Infinity comes through as
    // null after JSON serialisation and violates the NOT NULL DB constraint).
    if (!Number.isFinite(dto.base_price)) {
      throw new BadRequestException('base_price must be a valid number');
    }
    const { data, error } = await this.db.client
      .from('products')
      .insert(dto)
      .select()
      .single();
    if (error) {
      // Translate DB-level errors into 400s so the admin sees a clear message
      // instead of a generic 500 (Supabase errors are not HttpExceptions).
      throw new BadRequestException(error.message || 'Failed to create product');
    }
    this.triggerDeploy();
    return data;
  }

  async update(id: string, dto: Partial<CreateProductDto>) {
    const { data, error } = await this.db.client
      .from('products')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException(error.message || 'Failed to update product');
    if (!data) throw new NotFoundException('Product not found');

    // Cascade base_price to all variants so checkout always charges the
    // current product price (product_variants.price is what the order uses).
    if (dto.base_price !== undefined) {
      await this.db.client
        .from('product_variants')
        .update({ price: dto.base_price })
        .eq('product_id', id);
      // Ignore cascade errors — the product row is already saved.
    }

    this.triggerDeploy();
    return data;
  }

  /** Soft-delete (deactivate): hides from storefront, keeps all data. */
  async remove(id: string) {
    const { error } = await this.db.client
      .from('products')
      .update({ is_active: false })
      .eq('id', id);
    if (error) throw error;
    this.triggerDeploy();
    return { message: 'Product deactivated' };
  }

  /**
   * Hard-delete: permanently removes the product, all its variants, images,
   * and related records from the database. Irreversible — use only for
   * test/draft products that have never had orders.
   */
  async hardDelete(id: string) {
    // Check no paid orders reference this product's variants via order_items.
    // order_items has no product_id — join via product_variants instead.
    const { data: variants } = await this.db.client
      .from('product_variants').select('id').eq('product_id', id);
    const variantIds = (variants || []).map((v: any) => v.id);
    let hasOrders = false;
    if (variantIds.length) {
      const { count } = await this.db.client
        .from('order_items')
        .select('id', { count: 'exact', head: true })
        .in('variant_id', variantIds);
      hasOrders = (count ?? 0) > 0;
    }
    if (hasOrders) {
      throw new BadRequestException(
        'Cannot permanently delete a product that has order history. Deactivate it instead.',
      );
    }
    // Delete cascade: images → variants → product
    await this.db.client.from('product_images').delete().eq('product_id', id);
    await this.db.client.from('product_variants').delete().eq('product_id', id);
    const { error } = await this.db.client.from('products').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message || 'Delete failed');
    return { message: 'Product permanently deleted' };
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
