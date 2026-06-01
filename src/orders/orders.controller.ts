import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { Public } from '../common/decorators/public.decorator';

@Controller('orders')
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Public()
  @Post()
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: any) {
    return this.orders.createOrder(dto, user?.id);
  }

  @Get('my')
  getMyOrders(
    @CurrentUser() user: any,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    return this.orders.findAll(user.id, +page, +limit);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.orders.findOne(id, user);
  }

  @UseGuards(AdminGuard)
  @Get()
  findAll(@Query('page') page = '1', @Query('limit') limit = '20') {
    return this.orders.findAll(undefined, +page, +limit);
  }

  @UseGuards(AdminGuard)
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.orders.updateStatus(id, dto);
  }
}
