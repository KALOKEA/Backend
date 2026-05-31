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
  @Get('env-debug')
  envDebug() {
    const url = this.config.get('SUPABASE_URL') || '';
    const key = this.config.get('SUPABASE_SERVICE_KEY') || '';
    return {
      url_length: url.length,
      url_starts_with: url.slice(0, 8),
      url_ends_with: url.slice(-10),
      url_has_quotes: url.startsWith('"') || url.startsWith("'"),
      key_length: key.length,
      key_starts_with_eyJ: key.startsWith('eyJ'),
      key_first_10: key.slice(0, 10),
      key_has_quotes: key.startsWith('"') || key.startsWith("'"),
    };
  }
}
