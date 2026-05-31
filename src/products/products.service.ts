import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';

@Injectable()
export class ProductsService {
  constructor(private db: DatabaseService) {}

  async findAll(query: ProductQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let q = this.db.client
      .from('products')
      .select(`
        *,
        categories(id, name, slug),
        product_images(url, alt_text, is_primary, sort_order),
        product_variants(id, size, colour, price, stock, sku, is_active)
      `, { count: 'exact' })
      .eq('is_active', true)
      .range(from, to);

    if (query.category_id) q = q.eq('category_id', query.category_id);
    if (query.featured === 'true') q = q.eq('is_featured', true);
    if (query.min_price) q = q.gte('base_price', query.min_price);
    if (query.max_price) q = q.lte('base_price', query.max_price);
    if (query.search) q = q.ilike('name', `%${query.search}%`);

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
}
