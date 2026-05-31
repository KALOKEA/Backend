import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

@Injectable()
export class DatabaseService {
  public client: SupabaseClient;

  constructor(private config: ConfigService) {
    const url = this.config.getOrThrow('SUPABASE_URL');
    const key = this.config.getOrThrow('SUPABASE_SERVICE_KEY');

    this.client = createClient(url, key, {
      realtime: { transport: ws },
      global: {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      },
    });
  }
}
