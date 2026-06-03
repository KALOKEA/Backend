import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminGuard } from '../common/guards/admin.guard';

@UseGuards(AdminGuard)
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

  @Get('activity-log')
  getActivityLog(
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('action') action?: string,
    @Query('entity_type') entityType?: string,
  ) {
    return this.admin.getActivityLog(+page, +limit, action, entityType);
  }
}
