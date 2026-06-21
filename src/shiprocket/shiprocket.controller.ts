import {
  Controller, Post, Get, Delete, Patch, Body, Param, Headers,
  UseGuards, Logger, HttpCode
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { ShiprocketService } from './shiprocket.service';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('shiprocket')
@ApiBearerAuth('access-token')
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

  // ─── Admin: Generate manifest PDF ────────────────────────────────────────────
  @UseGuards(AdminGuard)
  @AdminAction('shiprocket.manifest')
  @Post('manifest')
  generateManifest(@Body() body: { shipment_ids: number[] }) {
    return this.sr.generateManifest(body.shipment_ids);
  }

  // ─── Admin: Bulk sync tracking for all active shipments ───────────────────────
  @UseGuards(AdminGuard)
  @Post('sync-tracking')
  syncTracking() {
    return this.sr.syncTrackingAll();
  }

  // ─── Admin: NDR list ─────────────────────────────────────────────────────────
  @UseGuards(AdminGuard)
  @Get('ndrs')
  getNdrs() {
    return this.sr.getNdrs();
  }

  // ─── Admin: NDR action ───────────────────────────────────────────────────────
  @UseGuards(AdminGuard)
  @AdminAction('shiprocket.ndr_action')
  @Post('ndrs/:shipmentId/action')
  ndrAction(
    @Param('shipmentId') shipmentId: string,
    @Body() body: { action: 'reAttempt' | 'return'; comment?: string },
  ) {
    return this.sr.ndrAction(shipmentId, body.action, body.comment);
  }

  // ─── Admin: Create return / reverse pickup ────────────────────────────────────
  @UseGuards(AdminGuard)
  @AdminAction('shiprocket.return_pickup')
  @Post('orders/:id/return')
  createReturnPickup(@Param('id') id: string) {
    return this.sr.createReturnPickup(id);
  }

  // ─── Admin: COD remittance ────────────────────────────────────────────────────
  @UseGuards(AdminGuard)
  @Get('remittance')
  getCodRemittance() {
    return this.sr.getCodRemittance();
  }

  // ─── Admin: Packaging profiles ────────────────────────────────────────────────
  @UseGuards(AdminGuard)
  @Get('packaging-profiles')
  getPackagingProfiles() {
    return this.sr.getPackagingProfiles();
  }

  @UseGuards(AdminGuard)
  @Post('packaging-profiles')
  createPackagingProfile(@Body() body: {
    name: string; weight: number; length: number;
    breadth: number; height: number; is_default?: boolean;
  }) {
    return this.sr.createPackagingProfile(body);
  }

  @UseGuards(AdminGuard)
  @Delete('packaging-profiles/:id')
  deletePackagingProfile(@Param('id') id: string) {
    return this.sr.deletePackagingProfile(id);
  }

  @UseGuards(AdminGuard)
  @Patch('packaging-profiles/:id/default')
  setDefaultProfile(@Param('id') id: string) {
    return this.sr.setDefaultPackagingProfile(id);
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
    if (!expected) {
      // Env var not configured → reject all incoming webhooks rather than accept blindly.
      this.logger.error(`SHIPROCKET_WEBHOOK_TOKEN not set — rejecting webhook to prevent spoofing`);
      return { ok: false };
    }
    if (srToken !== expected) {
      this.logger.warn(`ShipRocket webhook: invalid token header`);
      return { ok: false };
    }
    await this.sr.handleWebhook(payload);
    return { ok: true };
  }
}
