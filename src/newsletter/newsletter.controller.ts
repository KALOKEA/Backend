import { Controller, Post, Get, Query, Body, Res } from '@nestjs/common';
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
