import {
  Controller, Post, Get, Body, Param, Headers, UseGuards, Logger, HttpCode
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { ShiprocketService } from './shiprocket.service';
import { ConfigService } from '@nestjs/config';

@Controller('shiprocket')
export class ShiprocketController {
  private readonly logger = new Logger(ShiprocketController.name);

  constructor(
    private sr: ShiprocketService,
    private config: ConfigService,
  ) {}

  // ─── Admin: Push order to ShipRocket + auto-assign AWB ───────────────────────
  @UseGuards(AdminGuard)
  @AdminAction('shiprocket.push_order')
  @Post('orders/:id/push')
  pushOrder(
    @Param('id') id: string,
    @Body() body: { weight?: number; length?: number; breadth?: number; height?: number; courier_id?: number },
  ) {
    return this.sr.pushOrder(id, body);
  }

  // ─── Admin: Manually assign / reassign AWB ────────────────────────────────────
  @UseGuards(AdminGuard)
  @AdminAction('shiprocket.assign_awb')
  @Post('orders/:id/awb')
  assignAwb(@Param('id') id: string, @Body() body: { courier_id?: number }) {
    return this.sr.assignAwb(id, body?.courier_id);
  }

  // ─── Admin: Generate shipping label ──────────────────────────────────────────
  @UseGuards(AdminGuard)
  @Post('orders/:id/label')
  generateLabel(@Param('id') id: string) {
    return this.sr.generateLabel(id);
  }

  // ─── Admin: Schedule pickup ───────────────────────────────────────────────────
  @UseGuards(AdminGuard)
  @AdminAction('shiprocket.schedule_pickup')
  @Post('orders/:id/pickup')
  schedulePickup(@Param('id') id: string) {
    return this.sr.schedulePickup(id);
  }

  // ─── Admin: Track shipment ───────────────────────────────────────────────────
  @UseGuards(AdminGuard)
  @Get('orders/:id/track')
  trackShipment(@Param('id') id: string) {
    return this.sr.trackShipment(id);
  }

  // ─── Admin: Cancel shipment ──────────────────────────────────────────────────
  @UseGuards(AdminGuard)
  @AdminAction('shiprocket.cancel')
  @Post('orders/:id/cancel')
  cancelShipment(@Param('id') id: string) {
    return this.sr.cancelShipment(id);
  }

  // ─── Admin: Courier serviceability ───────────────────────────────────────────
  @UseGuards(AdminGuard)
  @Get('serviceability/:pincode')
  getServiceability(@Param('pincode') pincode: string) {
    return this.sr.getServiceability(pincode);
  }

  // ─── Public: Webhook from ShipRocket (no auth — verified by token header) ─────
  @Public()
  @HttpCode(200)
  @Post('webhook')
  async webhook(
    @Body() payload: any,
    @Headers('x-shiprocket-token') srToken: string,
  ) {
    const expected = this.config.get<string>('SHIPROCKET_WEBHOOK_TOKEN');
    if (expected && srToken !== expected) {
      this.logger.warn(`ShipRocket webhook: invalid token header`);
      return { ok: false };
    }
    await this.sr.handleWebhook(payload);
    return { ok: true };
  }
}
