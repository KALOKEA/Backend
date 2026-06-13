import { Controller, Get, Put, Body, Query, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('admin')
@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  /**
   * Public endpoint — safe fields only (no admin email, no GST internals).
   * Used by the frontend footer to fetch live social / brand links without auth.
   */
  @Public()
  @Get('public')
  async getPublic() {
    const s = await this.settings.get();
    return {
      footer_instagram_url:    s.footer_instagram_url,
      footer_whatsapp_url:     s.footer_whatsapp_url,
      footer_facebook_url:     s.footer_facebook_url,
      footer_pinterest_url:    s.footer_pinterest_url,
      live_chat_widget:        s.live_chat_widget,
      seller_gstin:            s.seller_gstin,
      seller_name:             s.seller_name,
      flash_sale_enabled:      s.flash_sale_enabled,
      flash_sale_end_time:     s.flash_sale_end_time,
      flash_sale_label:        s.flash_sale_label,
      flash_sale_discount_pct: s.flash_sale_discount_pct,
      flash_sale_coupon:       s.flash_sale_coupon,
    };
  }

  @UseGuards(AdminGuard)
  @ApiBearerAuth('access-token')
  @Get()
  get() {
    return this.settings.get();
  }

  @UseGuards(AdminGuard)
  @ApiBearerAuth('access-token')
  @AdminAction('settings.update')
  @Put()
  update(@Body() dto: UpdateSettingsDto) {
    return this.settings.update(dto);
  }

  @UseGuards(AdminGuard)
  @ApiBearerAuth('access-token')
  @Get('gst-report')
  gstReport(@Query('month') month?: string) {
    return this.settings.gstReport(month);
  }
}
