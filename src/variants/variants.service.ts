import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
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

  // Build a guaranteed-unique fallback SKU (random suffix) when the admin doesn't
  // supply their own. The old code generated `KLK-<id>-<colour|NA>-<size|NA>` which
  // COLLIDED on the UNIQUE(sku) constraint for single-option products (NA-NA) and
  // when re-adding a variant whose old row was only soft-deleted — that surfaced as
  // "cannot add variant". The random suffix removes that whole class of failure.
  private buildAutoSku(productId: string, colour?: string, size?: string): string {
    const clean = (s?: string) => (s || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
    const mid = [clean(colour), clean(size)].filter(Boolean).join('');
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return ['KLK', productId.slice(0, 6).toUpperCase(), mid, rand].filter(Boolean).join('-');
  }

  async create(dto: CreateVariantDto) {
    // Use the admin-supplied SKU as-is; only auto-generate when left blank.
    const sku = dto.sku?.trim() || this.buildAutoSku(dto.product_id, dto.colour, dto.size);
    const { data, error } = await this.db.client
      .from('product_variants')
      .insert({ ...dto, sku })
      .select()
      .single();
    if (error) {
      if ((error as any).code === '23505') {
        throw new ConflictException(`SKU "${sku}" is already in use. Please enter a different SKU.`);
      }
      throw error;
    }
    return data;
  }

  async update(id: string, dto: UpdateVariantDto) {
    const payload: Record<string, unknown> = { ...dto };
    // Allow the admin to set, change, or clear the SKU. Empty string clears it (NULL),
    // which is allowed by the UNIQUE constraint (Postgres permits multiple NULLs).
    if (typeof payload.sku === 'string') {
      payload.sku = (payload.sku as string).trim() || null;
    }
    const { data, error } = await this.db.client
      .from('product_variants')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) {
      if ((error as any).code === '23505') {
        throw new ConflictException(`SKU "${payload.sku as string}" is already in use. Please enter a different SKU.`);
      }
      throw new NotFoundException('Variant not found');
    }
    if (!data) throw new NotFoundException('Variant not found');
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
    // HARD delete. Safe because order_items.variant_id is ON DELETE SET NULL (order
    // history keeps its name/price snapshot) and cart_items is ON DELETE CASCADE.
    // Hard delete also frees the UNIQUE sku and the size/colour slot, so the same
    // variant can be re-added afterwards (the old soft-delete blocked re-adds).
    const { error } = await this.db.client
      .from('product_variants')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return { message: 'Variant deleted' };
  }
}
