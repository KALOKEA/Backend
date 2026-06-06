import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class HomepageContentService {
  constructor(private db: DatabaseService) {}

  /** Returns all homepage content as a flat key→value object. */
  async getAll(): Promise<Record<string, string>> {
    const { data, error } = await this.db.client
      .from('homepage_content')
      .select('key, value');
    if (error) throw error;
    const result: Record<string, string> = {};
    for (const row of data ?? []) {
      result[row.key] = row.value;
    }
    return result;
  }

  /** Upsert a single key. */
  async update(key: string, value: string): Promise<{ key: string; value: string }> {
    const { error } = await this.db.client
      .from('homepage_content')
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    return { key, value };
  }
}
