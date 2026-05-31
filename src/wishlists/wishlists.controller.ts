import { Controller, Get, Post, Delete, Param } from '@nestjs/common';
import { WishlistsService } from './wishlists.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('wishlists')
export class WishlistsController {
  constructor(private wishlists: WishlistsService) {}

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.wishlists.findAll(user.id);
  }

  @Post(':productId')
  add(@CurrentUser() user: any, @Param('productId') productId: string) {
    return this.wishlists.add(user.id, productId);
  }

  @Delete(':productId')
  remove(@CurrentUser() user: any, @Param('productId') productId: string) {
    return this.wishlists.remove(user.id, productId);
  }
}
