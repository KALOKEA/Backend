import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateAddressDto } from './dto/create-address.dto';

@Injectable()
export class AddressesService {
  constructor(private db: DatabaseService) {}

  async findAll(userId: string) {
    const { data } = await this.db.client
      .from('addresses').select('*').eq('user_id', userId).order('is_default', { ascending: false });
    return data || [];
  }

  async create(userId: string, dto: CreateAddressDto) {
    if (dto.is_default) {
      await this.db.client.from('addresses').update({ is_default: false }).eq('user_id', userId);
    }
    const { data, error } = await this.db.client
      .from('addresses').insert({ ...dto, user_id: userId }).select().single();
    if (error) throw error;
    return data;
  }

  async update(id: string, userId: string, dto: Partial<CreateAddressDto>) {
    if (dto.is_default) {
      await this.db.client.from('addresses').update({ is_default: false }).eq('user_id', userId);
    }
    const { data, error } = await this.db.client
      .from('addresses').update(dto).eq('id', id).eq('user_id', userId).select().single();
    if (error || !data) throw new NotFoundException('Address not found');
    return data;
  }

  async remove(id: string, userId: string) {
    await this.db.client.from('addresses').delete().eq('id', id).eq('user_id', userId);
    return { message: 'Address deleted' };
  }

  async setDefault(id: string, userId: string) {
    await this.db.client.from('addresses').update({ is_default: false }).eq('user_id', userId);
    await this.db.client.from('addresses').update({ is_default: true }).eq('id', id).eq('user_id', userId);
    return { message: 'Default address updated' };
  }
}
