import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminGuard } from '../common/guards/admin.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

// Explicit dual-guard: JwtAuthGuard runs first (validates + attaches user),
// then AdminGuard checks user.role === 'admin'. Belt-and-suspenders over the
// global JwtAuthGuard — prevents accidental exposure if global guard config changes.
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiTags('admin')
@ApiBearerAuth('access-token')
@Controller('admin')
export class AdminController {
  constructor(private admin: AdminService) {}

  @Get('dashboard')
  getDashboard() {
    return this.admin.getDashboard();
  }

  @Get('orders/recent')
  getRecentOrders() {
    return this.admin.getRecentOrders();
  }

  @Get('products/top')
  getTopProducts() {
    return this.admin.getTopProducts();
  }

  @Get('monthly-stats')
  getMonthlyStats(@Query('months') months = '6') {
    return this.admin.getMonthlyStats(+months);
  }

  @Get('activity-log')
  getActivityLog(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('action') action?: string,
    @Query('entity_type') entityType?: string,
  ) {
    return this.admin.getActivityLog(+page, +limit, action, entityType);
  }

  @Get('email-log')
  getEmailLog(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('status') status?: string,
    @Query('email_type') emailType?: string,
  ) {
    return this.admin.getEmailLog(+page, +limit, status, emailType);
  }
}
