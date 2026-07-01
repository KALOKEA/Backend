import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Res, UseGuards, ForbiddenException } from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { QuoteOrderDto } from './dto/quote-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('orders')
@Permission('orders')
@Controller('orders')
export class OrdersController {
  constructor(private orders: OrdersService) {}

  // @Public() lets the global JwtAuthGuard skip (so guests can check out),
  // while OptionalJwtAuthGuard parses the Bearer token IF present — so an
  // authenticated buyer's order is tied to their user_id and shows up in
  // GET /orders/my. Previously @Public alone left user undefined → null user_id.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 orders/min per IP — prevents spam/inventory exhaustion
  @Post()
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: any) {
    return this.orders.createOrder(dto, user?.id);
  }

  // Non-persisting price + GST quote for the checkout summary, so the tax the
  // customer sees matches exactly what they'll be charged.
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post('quote')
  quote(@Body() dto: QuoteOrderDto, @CurrentUser() user: any) {
    return this.orders.quote(dto as any, user?.id);
  }

  @Get('my')
  getMyOrders(
    @CurrentUser() user: any,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    return this.orders.findAll(user.id, +page, +limit);
  }

  /**
   * Admin: list ALL orders with pagination + optional status / archive filter.
   * Static route — MUST be declared before :id to avoid route ambiguity.
   * ?archived=true  → only orders that are auto-archived (delivered/cancelled older than 8 days)
   * ?archived=false → default — exclude auto-archived orders from main view
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Get()
  listAllOrders(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('archived') archived?: string,
  ) {
    const archivedBool = archived === 'true' ? true : archived === 'false' ? false : undefined;
    return this.orders.findAll(undefined, +page, +limit, status, search, archivedBool);
  }

  /** Admin: export all orders as CSV. Static route MUST be declared before :id. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
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

  /**
   * Guest order status lookup — public endpoint.
   * Returns minimal order info (status, items, total) for guest tracking page.
   * Requires both order_number AND email to prove ownership.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('guest/track')
  trackGuestOrder(@Body() body: { order_number: string; email: string }) {
    return this.orders.trackGuestOrder(body.order_number, body.email);
  }

  /**
   * Get a single order. Authenticated users must own the order (admin can see
   * all). Guests pass ?guest_email= — the service enforces email ownership.
   * Declared AFTER all static-segment routes (my, export, guest/track) so the
   * :id segment never shadows them.
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('guest_email') guestEmail?: string,
  ) {
    return this.orders.findOne(id, user, guestEmail);
  }

  /**
   * Admin: move order to archived view (hides from main orders list).
   * Archived orders are still stored and accessible via ?archived=true.
   * No data is deleted — safe for GST records.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @AdminAction('order.archive')
  @Patch(':id/archive')
  archiveOrder(@Param('id') id: string) {
    return this.orders.archiveOrder(id);
  }

  /**
   * Admin: permanently delete an order (only for test/junk orders with no payment).
   * Blocked if order has payment_status='paid'. Safe for dev/test cleanup.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @AdminAction('order.delete')
  @Delete(':id')
  deleteOrder(@Param('id') id: string) {
    return this.orders.deleteOrder(id);
  }

  /**
   * Admin: update order status (shipped, delivered, cancelled, etc.).
   * Triggers customer email for each status transition.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @AdminAction('order.status_change')
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.orders.updateStatus(id, dto, user?.email);
  }

  /**
   * Printable tax invoice / booking confirmation HTML.
   * Authenticated users must own the order. Guests pass ?guest_email=<email>.
   * Returns full HTML page — set as iframe src or window.open target.
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id/invoice')
  async getInvoice(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('guest_email') guestEmail: string,
    @Res() res: Response,
  ) {
    const html = await this.orders.getInvoice(id, user, guestEmail);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }
}
