import { Controller, Get, Patch, Body, Query, Param, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';

@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: any) {
    return this.users.findOne(user.id);
  }

  @Patch('me')
  updateProfile(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  // One-click export of ALL customer data (admin). Declared before ':id/...'
  // so the literal 'export' isn't read as an id.
  @UseGuards(AdminGuard)
  @Get('export')
  async exportAll(@Res() res: Response) {
    const csv = await this.users.exportAllCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="kalokea-customers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + csv); // BOM for Excel UTF-8
  }

  @UseGuards(AdminGuard)
  @Get(':id/detail')
  getDetail(@Param('id') id: string) {
    return this.users.getDetail(id);
  }

  @UseGuards(AdminGuard)
  @Get()
  findAll(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.users.findAll(+page, +limit);
  }
}
