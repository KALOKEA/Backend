import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, HttpCode, UseInterceptors } from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { Throttle } from '@nestjs/throttler';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { AdminCreateReviewDto } from './dto/admin-create-review.dto';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private reviews: ReviewsService) {}

  @Public()
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(120000)
  @Get('product/:productId')
  findByProduct(@Param('productId') productId: string) {
    return this.reviews.findByProduct(productId);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 reviews/min per IP
  @Post()
  create(@Body() dto: CreateReviewDto, @CurrentUser() user: any) {
    return this.reviews.create(dto, user.id);
  }

  @Get('my')
  findMine(@CurrentUser() user: any) {
    return this.reviews.findByUser(user.id);
  }

  @UseGuards(AdminGuard)
  @Get('admin/all')
  findAll(
    @Query('page') page = '1',
    @Query('limit') limit = '30',
  ) {
    return this.reviews.findAll(+page, +limit);
  }

  @UseGuards(AdminGuard)
  @Get('pending')
  findPending() {
    return this.reviews.findPending();
  }

  @UseGuards(AdminGuard)
  @AdminAction('review.create')
  @Post('admin/create')
  adminCreate(@Body() dto: AdminCreateReviewDto) {
    return this.reviews.adminCreate(dto);
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

  @UseGuards(AdminGuard)
  @AdminAction('review.reply')
  @Post(':id/reply')
  reply(@Param('id') id: string, @Body('reply') reply: string) {
    return this.reviews.replyToReview(id, reply);
  }

  @UseGuards(AdminGuard)
  @AdminAction('review.flag')
  @HttpCode(200)
  @Post(':id/flag')
  flag(
    @Param('id') id: string,
    @Body('flagged') flagged: boolean,
    @Body('flag_reason') flagReason?: string,
  ) {
    return this.reviews.flagReview(id, flagged, flagReason);
  }
}
