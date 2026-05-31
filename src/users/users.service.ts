import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private db: DatabaseService) {}

  async findOne(id: string) {
    const { data } = await this.db.client
      .from('users')
      .select('id, name, email, phone, role, created_at')
      .eq('id', id)
      .single();
    if (!data) throw new NotFoundException('User not found');
    return data;
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    const { data, error } = await this.db.client
      .from('users')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, name, email, phone, role')
      .single();
    if (error) throw error;
    return data;
  }

  async findAll(page = 1, limit = 20) {
    const from = (page - 1) * limit;
    const { data, count } = await this.db.client
      .from('users')
      .select('id, name, email, phone, role, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);
    return { data, meta: { total: count, page, limit } };
  }
}
