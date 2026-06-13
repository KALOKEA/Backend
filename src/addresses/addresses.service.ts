import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
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
      // Clear existing default before inserting new one; silent failure here
      // is acceptable — the explicit insert error below is the critical check.
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
    const { error } = await this.db.client.from('addresses').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new InternalServerErrorException('Failed to delete address');
    return { message: 'Address deleted' };
  }

  async setDefault(id: string, userId: string) {
    // Clear all defaults first; if this fails throw immediately so we never
    // leave the user with no default address on the second write.
    const { error: clearErr } = await this.db.client
      .from('addresses').update({ is_default: false }).eq('user_id', userId);
    if (clearErr) throw new InternalServerErrorException('Failed to update default address');
    const { error: setErr } = await this.db.client
      .from('addresses').update({ is_default: true }).eq('id', id).eq('user_id', userId);
    if (setErr) throw new InternalServerErrorException('Failed to set default address');
    return { message: 'Default address updated' };
  }
}
