import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { WhatsAppService } from './whatsapp.service';
import { DatabaseService } from '../database/database.service';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

/**
 * Admin-only WhatsApp actions. Transactional messages (order confirmation,
 * shipped, delivered, pending-payment, abandoned-cart) are sent automatically
 * by the order/cron/shiprocket flows — this controller is for manual broadcasts.
 */
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiTags('whatsapp')
@ApiBearerAuth('access-token')
@Controller('admin/whatsapp')
export class WhatsAppController {
  constructor(
    private whatsapp: WhatsAppService,
    private db: DatabaseService,
  ) {}

  /**
   * Broadcast a "new launch" WhatsApp message to every customer with a phone on
   * file. NOTE: new_launch is a Meta MARKETING-category template — in production
   * only send to customers who have opted in to marketing, and Meta bills per
   * marketing conversation. Sends are fire-and-forget; returns the count queued.
   */
  @AdminAction('whatsapp.new_launch')
  @Post('new-launch')
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
