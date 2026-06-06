import { Controller, Get, Post, Patch, Body, Param, Query, Res, UseGuards, ForbiddenException } from '@nestjs/common';
import { Response } from 'express';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { AdminAction } from '../common/decorators/admin-action.decorator';

@Controller('orders')
export class OrdersController {
  constructor(private orders: OrdersService) {}

  // @Public() lets the global JwtAuthGuard skip (so guests can check out),
  // while OptionalJwtAuthGuard parses the Bearer token IF present — so an
  // authenticated buyer's order is tied to their user_id and shows up in
  // GET /orders/my. Previously @Public alone left user undefined → null user_id.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: any) {
    return this.orders.createOrder(dto, user?.id);
  }

  // Non-persisting price + GST quote for the checkout summary, so the tax the
  // customer sees matches exactly what they'll be charged.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('quote')
  quote(@Body() dto: CreateOrderDto, @CurrentUser() user: any) {
    return this.orders.quote(dto, user?.id);
  }

  @Get('my')
  getMyOrders(
    @CurrentUser() user: any,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    return this.orders.findAll(user.id, +page, +limit);
  }

  /** Admin: export all orders as CSV. Static route MUST be declared before :id. */
  @UseGuards(AdminGuard)
  @Get('export')
  async exportCsv(
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.orders.exportOrdersCsv({ status, from, to });
    const filename = `kalokea-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv); // UTF-8 BOM so Excel opens correctly
  }

  /** Cancel an order within the 12-hour window (authenticated user only). */
  @Post(':id/cancel')
  cancelOrder(@Param('id') id: string, @CurrentUser() user: any) {
    if (!user?.id) throw new ForbiddenException('Login required');
    return this.orders.cancelOrder(id, user.id);
  }

  @Get(':id/invoice')
  getInvoice(@Param('id') id: string, @CurrentUser() user: any) {
    return this.orders.getInvoice(id, user);
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
  @AdminAction('order.status_change')
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.orders.updateStatus(id, dto);
  }
}
