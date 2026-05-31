import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';

@Injectable()
export class VariantsService {
  constructor(private db: DatabaseService) {}

  async findByProduct(productId: string) {
    const { data, error } = await this.db.client
      .from('product_variants')
      .select('*')
      .eq('product_id', productId)
      .eq('is_active', true)
      .order('size');
    if (error) throw error;
    return data;
  }

  async create(dto: CreateVariantDto) {
    const sku = dto.sku || `KLK-${dto.product_id.slice(0, 6)}-${dto.colour || 'NA'}-${dto.size || 'NA'}`.toUpperCase();
    const { data, error } = await this.db.client
      .from('product_variants')
      .insert({ ...dto, sku })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async update(id: string, dto: UpdateVariantDto) {
    const { data, error } = await this.db.client
      .from('product_variants')
      .update(dto)
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new NotFoundException('Variant not found');
    return data;
  }

  async updateStock(id: string, stock: number) {
    const { data, error } = await this.db.client
      .from('product_variants')
      .update({ stock })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new NotFoundException('Variant not found');
    return data;
  }

  async remove(id: string) {
    const { error } = await this.db.client
      .from('product_variants')
      .update({ is_active: false })
      .eq('id', id);
    if (error) throw error;
    return { message: 'Variant deactivated' };
  }
}
