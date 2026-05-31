import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';

@Controller('coupons')
export class CouponsController {
  constructor(private coupons: CouponsService) {}

  @Public()
  @Post('validate')
  validate(@Body() dto: ValidateCouponDto) {
    return this.coupons.validate(dto);
  }

  @UseGuards(AdminGuard)
  @Get()
  findAll() {
    return this.coupons.findAll();
  }

  @UseGuards(AdminGuard)
  @Post()
  create(@Body() dto: CreateCouponDto) {
    return this.coupons.create(dto);
  }

  @UseGuards(AdminGuard)
  @Patch(':id/toggle')
  toggle(@Param('id') id: string) {
    return this.coupons.toggle(id);
  }
}
