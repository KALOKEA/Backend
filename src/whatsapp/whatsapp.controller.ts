import {
  Controller, Post, Get, Body, Query, Res, UseGuards, Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { WhatsAppService } from './whatsapp.service';
import { DatabaseService } from '../database/database.service';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

/**
 * WhatsApp controller:
 *  - Public webhook endpoint (/whatsapp/webhook) — Meta calls this for delivery
 *    status updates and incoming messages. No auth required.
 *  - Admin endpoints (/whatsapp/admin/*) — protected by JWT + AdminGuard.
 */
@ApiTags('whatsapp')
@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private whatsapp: WhatsAppService,
    private db: DatabaseService,
    private config: ConfigService,
  ) {}

  // ─── Public Webhook (Meta → us) ──────────────────────────────────────────

  /**
   * GET /whatsapp/webhook
   * Meta calls this once during webhook setup to verify our endpoint.
   * Responds with hub.challenge if the verify token matches.
   */
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const verifyToken =
      this.config.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN') ||
      'kalokea_webhook_verify';

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('WhatsApp webhook verified ✅');
      return res.status(200).send(challenge);
    }
    this.logger.warn('WhatsApp webhook verify failed — token mismatch');
    return res.sendStatus(403);
  }

  /**
   * POST /whatsapp/webhook
   * Receives delivery status updates and incoming customer messages from Meta.
   * Always respond 200 immediately so Meta doesn't retry.
   */
  @Post('webhook')
  receiveWebhook(@Body() payload: any, @Res() res: Response) {
    // Acknowledge immediately — never block Meta's delivery
    res.sendStatus(200);

    try {
      const entries: any[] = payload?.entry ?? [];
      for (const entry of entries) {
        for (const change of entry.changes ?? []) {
          const value = change.value;

          // Delivery/read status updates
          for (const status of value?.statuses ?? []) {
            this.logger.log(
              `WA status [${status.status}] msgId=${status.id} to=${status.recipient_id}`,
            );
          }

          // Incoming messages from customers (for future live chat / auto-reply)
          for (const msg of value?.messages ?? []) {
            this.logger.log(
              `WA incoming [${msg.type}] from=${msg.from} text="${msg.text?.body ?? ''}"`,
            );
          }
        }
      }
    } catch (err: any) {
      this.logger.error(`WhatsApp webhook parse error: ${err?.message}`);
    }

    return; // res already sent above
  }

  // ─── Admin Actions ────────────────────────────────────────────────────────

  /**
   * POST /whatsapp/admin/new-launch
   * Broadcast a "new launch" WhatsApp message to every customer with a phone on
   * file. NOTE: new_launch is a Meta MARKETING-category template — in production
   * only send to customers who have opted in to marketing, and Meta bills per
   * marketing conversation. Sends are fire-and-forget; returns the count queued.
   */
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth('access-token')
  @AdminAction('whatsapp.new_launch')
  @Post('admin/new-launch')
  async broadcastNewLaunch(@Body() body: { name: string }) {
    const name = (body?.name || '').trim();
    if (!name) return { sent: 0, message: 'A launch name/title is required.' };

    const { data: users } = await this.db.client
      .from('users')
      .select('phone')
      .not('phone', 'is', null);

    const phones = Array.from(
      new Set((users ?? []).map((u: any) => u.phone).filter(Boolean)),
    );

    for (const phone of phones) {
      this.whatsapp.sendNewLaunch(phone as string, name);
    }

    return {
      sent: phones.length,
      message: `New-launch broadcast queued to ${phones.length} customer(s).`,
    };
  }
}
