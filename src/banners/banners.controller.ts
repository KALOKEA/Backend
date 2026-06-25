import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { BannersService } from './banners.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { Public } from '../common/decorators/public.decorator';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('banners')
@ApiBearerAuth('access-token')
@Permission('banners')
@Controller('banners')
export class BannersController {
  constructor(private banners: BannersService) {}

  @Public()
  @Get()
  findAll(@Query('position') position?: string) {
    return this.banners.findAll(position);
  }

  @UseGuards(PermissionsGuard)
  @Get('admin')
  findAllAdmin() {
    return this.banners.findAllAdmin();
  }

  @UseGuards(PermissionsGuard)
  @AdminAction('banner.create')
  @Post()
  create(@Body() dto: CreateBannerDto) {
    return this.banners.create(dto);
  }

  @UseGuards(PermissionsGuard)
  @AdminAction('banner.update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateBannerDto>) {
    return this.banners.update(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @AdminAction('banner.delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.banners.remove(id);
  }
}
