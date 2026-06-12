import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { StockNotificationsService } from './stock-notifications.service';
import { SubscribeNotifyDto } from './dto/subscribe-notify.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('stock-notifications')
@Controller('stock-notifications')
export class StockNotificationsController {
  constructor(private svc: StockNotificationsService) {}

  @Public()
  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Subscribe to back-in-stock email for an out-of-stock variant' })
  async subscribe(@Body() dto: SubscribeNotifyDto) {
    await this.svc.subscribe(dto.variant_id, dto.email);
    return { message: "We'll email you as soon as this item is back in stock." };
  }
}
