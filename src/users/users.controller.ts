import { Controller, Get, Post, Patch, Delete, Body, Query, Param, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('users')
@ApiBearerAuth('access-token')
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

  /** Customers section: export all customers as CSV. Declared before ':id' routes. */
  @UseGuards(PermissionsGuard)
  @Permission('customers')
  @Get('export')
  async exportAll(@Res() res: Response) {
    const csv = await this.users.exportAllCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="kalokea-customers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + csv);
  }

  /** Customers section: search by name / email / phone. */
  @UseGuards(PermissionsGuard)
  @Permission('customers')
  @Get('search')
  search(@Query('q') q = '') {
    return this.users.search(q);
  }

  // ── Staff & access management (owner / full-admin only) ────────────────────

  /** Owner: list all admin + staff accounts and their granted permissions. */
  @UseGuards(AdminGuard)
  @Get('staff/list')
  listStaff() {
    return this.users.listStaff();
  }

  /** Owner: create (or promote) a staff member with limited permissions. */
  @UseGuards(AdminGuard)
  @AdminAction('staff.create')
  @Post('staff')
  createStaff(@Body() body: { name?: string; email?: string; phone?: string; permissions?: string[] }) {
    return this.users.createStaff(body);
  }

  /** Owner: update a staff member's name and/or permissions. */
  @UseGuards(AdminGuard)
  @AdminAction('staff.update')
  @Patch('staff/:id')
  updateStaff(@Param('id') id: string, @Body() body: { name?: string; permissions?: string[] }) {
    return this.users.updateStaff(id, body);
  }

  /** Owner: revoke a staff member's admin access. */
  @UseGuards(AdminGuard)
  @AdminAction('staff.revoke')
  @Delete('staff/:id')
  revokeStaff(@Param('id') id: string) {
    return this.users.revokeStaff(id);
  }

  @UseGuards(PermissionsGuard)
  @Permission('customers')
  @Get(':id/detail')
  getDetail(@Param('id') id: string) {
    return this.users.getDetail(id);
  }

  @UseGuards(PermissionsGuard)
  @Permission('customers')
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

  /** Admin: permanently delete a user (blocked if they have orders). */
  @UseGuards(AdminGuard)
  @AdminAction('user.delete')
  @Delete(':id')
  deleteUser(@Param('id') id: string) {
    return this.users.deleteUser(id);
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
