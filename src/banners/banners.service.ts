import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateBannerDto } from './dto/create-banner.dto';

@Injectable()
export class BannersService {
  constructor(private db: DatabaseService) {}

  async findAll(position?: string) {
    let q = this.db.client
      .from('banners').select('*').eq('is_active', true).order('sort_order');
    if (position) q = q.eq('position', position);
    const { data } = await q;
    return data || [];
  }

  async findAllAdmin() {
    const { data } = await this.db.client
      .from('banners').select('*').order('sort_order');
    return data || [];
  }

  async create(dto: CreateBannerDto) {
    const { data, error } = await this.db.client
      .from('banners').insert(dto).select().single();
    if (error) throw error;
    return data;
  }

  async update(id: string, dto: Partial<CreateBannerDto>) {
    const { data, error } = await this.db.client
      .from('banners').update(dto).eq('id', id).select().single();
    if (error || !data) throw new NotFoundException('Banner not found');
    return data;
  }

  async remove(id: string) {
    const { error } = await this.db.client.from('banners').delete().eq('id', id);
    if (error) throw new InternalServerErrorException('Failed to delete banner');
    return { message: 'Banner deleted' };
  }
}
