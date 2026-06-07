import { Controller, Post, Get, Query, Body, Res, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { NewsletterService } from './newsletter.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('newsletter')
@Controller('newsletter')
export class NewsletterController {
  constructor(private newsletter: NewsletterService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('subscribe')
  subscribe(@Body() dto: SubscribeDto) {
    return this.newsletter.subscribe(dto.email);
  }

  /** DPDP Act 2023 compliance — users must be able to withdraw consent. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('unsubscribe')
  unsubscribe(@Body() dto: SubscribeDto) {
    return this.newsletter.unsubscribe(dto.email);
  }

  /**
   * One-click unsubscribe via GET link in emails (RFC 8058 / CAN-SPAM / DPDP compliance).
   * The email in the URL is base64-encoded to prevent trivial harvesting.
   * Returns an HTML confirmation page so the link is clickable directly from email clients.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Get('unsubscribe')
  async unsubscribeGet(
    @Query('t') token: string,
    @Res() res: Response,
  ) {
    if (!token) throw new BadRequestException('Missing token');
    let email: string;
    try {
      email = Buffer.from(token, 'base64url').toString('utf8');
      // Basic sanity check
      if (!email.includes('@')) throw new Error('invalid');
    } catch {
      throw new BadRequestException('Invalid token');
    }
    await this.newsletter.unsubscribe(email);
    // Return a simple confirmation page — no redirect needed since the frontend
    // is a static site and we can't inject dynamic state into it from the backend.
    (res as any).setHeader('Content-Type', 'text/html; charset=utf-8');
    (res as any).send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribed — Kalokea</title>
<style>body{font-family:Arial,Helvetica,sans-serif;background:#f4f2ef;margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;}
.card{background:#fff;border:1px solid #e8e4e0;padding:48px 40px;max-width:480px;width:100%;text-align:center;}
h1{font-size:22px;color:#0a0a0a;margin:0 0 12px;} p{font-size:14px;color:#6b6b6b;line-height:1.7;margin:0 0 24px;}
a{display:inline-block;padding:11px 28px;background:#0a0a0a;color:#fff;text-decoration:none;font-size:11px;letter-spacing:2px;text-transform:uppercase;}</style>
</head>
<body><div class="card">
<h1>You&rsquo;ve been unsubscribed</h1>
<p>We&rsquo;ve removed <strong>${email.replace(/</g, '&lt;')}</strong> from our mailing list. You won&rsquo;t receive any further marketing emails from Kalokea.</p>
<a href="https://kalokea.in">Back to Shop</a>
</div></body></html>`);
  }

  /** Admin: paginated subscriber list */
  @UseGuards(AdminGuard)
  @Get('admin/subscribers')
  listSubscribers(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('active') active?: string,
  ) {
    return this.newsletter.listSubscribers(+page, +limit, active);
  }

  /** Admin: CSV export of all active subscribers */
  @UseGuards(AdminGuard)
  @Get('admin/export')
  async exportSubscribers(@Res() res: Response) {
    const csv = await this.newsletter.exportCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="kalokea-subscribers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }
}
