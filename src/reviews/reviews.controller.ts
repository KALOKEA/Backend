import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminAction } from '../common/decorators/admin-action.decorator';

@Controller('reviews')
export class ReviewsController {
  constructor(private reviews: ReviewsService) {}

  @Public()
  @Get('product/:productId')
  findByProduct(@Param('productId') productId: string) {
    return this.reviews.findByProduct(productId);
  }

  @Post()
  create(@Body() dto: CreateReviewDto, @CurrentUser() user: any) {
    return this.reviews.create(dto, user.id);
  }

  @UseGuards(AdminGuard)
  @Get('pending')
  findPending() {
    return this.reviews.findPending();
  }

  @UseGuards(AdminGuard)
  @AdminAction('review.approve')
  @Patch(':id/approve')
  approve(@Param('id') id: string) {
    return this.reviews.approve(id);
  }

  @UseGuards(AdminGuard)
  @AdminAction('review.reject')
  @Delete(':id/reject')
  reject(@Param('id') id: string) {
    return this.reviews.reject(id);
  }
}
