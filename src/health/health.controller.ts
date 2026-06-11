import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ApiTags } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  /** Liveness probe — returns 200 if the process is running. */
  @Public()
  @Get('health')
  @HttpCode(HttpStatus.OK)
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: Math.floor(process.uptime()),
    };
  }

  /**
   * Readiness probe — returns 200 only when the database is reachable.
   * Use this URL in Railway health checks and uptime monitors.
   */
  @Public()
  @Get('health/ready')
  @HttpCode(HttpStatus.OK)
  async ready() {
    const start = Date.now();
    try {
      // Lightweight query that exercises the Supabase connection without a table scan.
      const { error } = await this.db.client
        .from('products')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      return {
        status: 'ready',
        db: 'ok',
        latency_ms: Date.now() - start,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      // Throw ServiceUnavailableException so the HTTP status is 503 (not 500),
      // which is the correct signal for a failed readiness probe.
      throw new ServiceUnavailableException({
        status: 'not_ready',
        db: 'error',
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
    }
  }
}
