import { Controller, Get, Put, Body, Query, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { AdminGuard } from '../common/guards/admin.guard';

@UseGuards(AdminGuard)
@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Put()
  update(@Body() dto: UpdateSettingsDto) {
    return this.settings.update(dto);
  }

  @Get('gst-report')
  gstReport(@Query('month') month?: string) {
    return this.settings.gstReport(month);
  }
}
