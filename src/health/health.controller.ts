import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ConfigService } from '@nestjs/config';

@Controller()
export class HealthController {
  constructor(private config: ConfigService) {}

  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  }

  @Public()
  @Get('supabase-raw')
  async supabaseRaw() {
    const url = this.config.get('SUPABASE_URL') || '';
    const key = this.config.get('SUPABASE_SERVICE_KEY') || '';

    const response = await fetch(`${url}/rest/v1/categories?select=id,name&limit=1`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
    });

    const body = await response.text();
    return {
      status: response.status,
      statusText: response.statusText,
      body: body.slice(0, 500),
    };
  }
}
