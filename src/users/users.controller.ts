import { Controller, Get, Post, Patch, Body, Query, Param, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';

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

  /** Admin: export all customers as CSV. Declared before ':id' routes. */
  @UseGuards(AdminGuard)
  @Get('export')
  async exportAll(@Res() res: Response) {
    const csv = await this.users.exportAllCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="kalokea-customers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + csv);
  }

  /** Admin: search by name / email / phone. */
  @UseGuards(AdminGuard)
  @Get('search')
  search(@Query('q') q = '') {
    return this.users.search(q);
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

  /** Admin: create a new user (e.g. add another admin account). */
  @UseGuards(AdminGuard)
  @AdminAction('user.create')
  @Post()
  adminCreate(
    @Body() body: { name?: string; email?: string; phone?: string; role?: string },
  ) {
    return this.users.adminCreate(body);
  }

  /** Admin: edit any user's profile or promote/demote role. */
  @UseGuards(AdminGuard)
  @AdminAction('user.update')
  @Patch(':id')
  adminUpdate(
    @Param('id') id: string,
    @Body() body: { name?: string; email?: string; phone?: string; role?: string },
  ) {
    return this.users.adminUpdate(id, body);
  }
}
