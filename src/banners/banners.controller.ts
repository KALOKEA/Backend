import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';

@Controller('banners')
export class BannersController {
  constructor(private banners: BannersService) {}

  @Public()
  @Get()
  findAll(@Query('position') position?: string) {
    return this.banners.findAll(position);
  }

  @UseGuards(AdminGuard)
  @Get('admin')
  findAllAdmin() {
    return this.banners.findAllAdmin();
  }

  @UseGuards(AdminGuard)
  @AdminAction('banner.create')
  @Post()
  create(@Body() dto: CreateBannerDto) {
    return this.banners.create(dto);
  }

  @UseGuards(AdminGuard)
  @AdminAction('banner.update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateBannerDto>) {
    return this.banners.update(id, dto);
  }

  @UseGuards(AdminGuard)
  @AdminAction('banner.delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.banners.remove(id);
  }
}
