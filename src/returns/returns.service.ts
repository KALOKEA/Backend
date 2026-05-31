import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateReturnDto } from './dto/create-return.dto';

@Injectable()
export class ReturnsService {
  constructor(private db: DatabaseService) {}

  async create(dto: CreateReturnDto, userId: string) {
    const { data, error } = await this.db.client
      .from('returns')
      .insert({ ...dto, user_id: userId, status: 'requested' })
      .select().single();
    if (error) throw error;
    return data;
  }

  async findAll() {
    const { data } = await this.db.client
      .from('returns')
      .select('*, orders(order_number), users(name, email)')
      .order('created_at', { ascending: false });
    return data || [];
  }

  async findByUser(userId: string) {
    const { data } = await this.db.client
      .from('returns')
      .select('*, orders(order_number)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return data || [];
  }

  async updateStatus(id: string, status: string, adminNotes?: string) {
    const { data, error } = await this.db.client
      .from('returns')
      .update({ status, admin_notes: adminNotes, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select().single();
    if (error || !data) throw new NotFoundException('Return not found');
    return data;
  }
}
