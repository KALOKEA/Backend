import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateCategoryDto } from './dto/create-category.dto';

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(private db: DatabaseService) {}

  async findAll() {
    const { data, error } = await this.db.client
      .from('categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) {
      this.logger.error('findAll error:', error);
      throw error;
    }
    return data;
  }

  async findBySlug(slug: string) {
    const { data, error } = await this.db.client
      .from('categories')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .single();
    if (error || !data) throw new NotFoundException('Category not found');
    return data;
  }

  async create(dto: CreateCategoryDto) {
    const { data: existing } = await this.db.client
      .from('categories')
      .select('id')
      .eq('slug', dto.slug)
      .single();
    if (existing) throw new ConflictException('Slug already exists');
    const { data, error } = await this.db.client
      .from('categories')
      .insert(dto)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, dto: Partial<CreateCategoryDto>) {
    const { data, error } = await this.db.client
      .from('categories')
      .update(dto)
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new NotFoundException('Category not found');
    return data;
  }

  async remove(id: string) {
    const { error } = await this.db.client
      .from('categories')
      .update({ is_active: false })
      .eq('id', id);
    if (error) throw error;
    return { message: 'Category deactivated' };
  }

  async seed() {
    const categories = [
      { name: 'New Arrivals', slug: 'new-arrivals', sort_order: 1 },
      { name: 'Dresses', slug: 'dresses', sort_order: 2 },
      { name: 'Tops', slug: 'tops', sort_order: 3 },
      { name: 'Bottoms', slug: 'bottoms', sort_order: 4 },
      { name: 'Shoes', slug: 'shoes', sort_order: 5 },
      { name: 'Bags', slug: 'bags', sort_order: 6 },
      { name: 'Accessories', slug: 'accessories', sort_order: 7 },
      { name: 'Sale', slug: 'sale', sort_order: 8 },
      { name: 'Everything', slug: 'everything', sort_order: 9 },
    ];
    const { data, error } = await this.db.client
      .from('categories')
      .upsert(categories, { onConflict: 'slug' })
      .select();
    if (error) {
      this.logger.error('seed error:', error);
      throw error;
    }
    return data;
  }
}
