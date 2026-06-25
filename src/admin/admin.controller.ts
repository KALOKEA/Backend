import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminGuard } from '../common/guards/admin.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

// JwtAuthGuard validates + attaches the user; PermissionsGuard then allows full
// admins (any endpoint) and staff (endpoints matching their permissions, or
// endpoints with no specific permission such as the dashboard). Sensitive logs
// (email log, activity log) re-add AdminGuard at the method level so they stay
// owner-only even for staff.
@UseGuards(JwtAuthGuard, PermissionsGuard)
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

  @UseGuards(AdminGuard)
  @Get('activity-log')
  getActivityLog(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('action') action?: string,
    @Query('entity_type') entityType?: string,
  ) {
    return this.admin.getActivityLog(+page, +limit, action, entityType);
  }

  @UseGuards(AdminGuard)
  @Get('email-log')
  getEmailLog(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('status') status?: string,
    @Query('email_type') emailType?: string,
  ) {
    return this.admin.getEmailLog(+page, +limit, status, emailType);
  }

  @UseGuards(AdminGuard)
  @Get('email-log/:id')
  getEmailLogEntry(@Param('id') id: string) {
    return this.admin.getEmailLogEntry(id);
  }

  @UseGuards(AdminGuard)
  @Post('email-log/:id/resend')
  resendEmail(@Param('id') id: string) {
    return this.admin.resendEmail(id);
  }

  @Permission('analytics')
  @Get('analytics/clv')
  getClv() {
    return this.admin.getCustomerLifetimeValue();
  }

  @Permission('analytics')
  @Get('analytics/conversion-rate')
  getConversionRate() {
    return this.admin.getConversionRate();
  }

  @Permission('analytics')
  @Get('analytics/sales-by-category')
  getSalesByCategory() {
    return this.admin.getSalesByCategory();
  }
}
