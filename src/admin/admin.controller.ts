import { Controller, Get, UseGuards } from '@nestjs/common';
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
}
