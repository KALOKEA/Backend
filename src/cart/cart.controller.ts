import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { MergeCartDto } from './dto/merge-cart.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('cart')
export class CartController {
  constructor(private cart: CartService) {}

  @Public()
  @Get()
  getCart(
    @CurrentUser() user: any,
    @Query('session_id') sessionId?: string,
  ) {
    return this.cart.getCart(user?.id, sessionId);
  }

  @Public()
  @Post('items')
  addItem(@Body() dto: AddToCartDto, @CurrentUser() user: any) {
    return this.cart.addItem(dto, user?.id);
  }

  @Public()
  @Patch('items/:id')
  updateItem(
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
    @CurrentUser() user: any,
    @Query('session_id') sessionId?: string,
  ) {
    return this.cart.updateItem(id, dto, user?.id, sessionId);
  }

  @Public()
  @Delete('items/:id')
  removeItem(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('session_id') sessionId?: string,
  ) {
    return this.cart.removeItem(id, user?.id, sessionId);
  }

  @Public()
  @Delete()
  clearCart(
    @CurrentUser() user: any,
    @Query('session_id') sessionId?: string,
  ) {
    return this.cart.clearCart(user?.id, sessionId);
  }

  @Post('merge')
  mergeCart(@Body() dto: MergeCartDto, @CurrentUser() user: any) {
    return this.cart.mergeCart(user.id, dto);
  }
}
