import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';

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
  @AdminAction('coupon.create')
  @Post()
  create(@Body() dto: CreateCouponDto) {
    return this.coupons.create(dto);
  }

  @UseGuards(AdminGuard)
  @AdminAction('coupon.update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateCouponDto>) {
    return this.coupons.update(id, dto);
  }

  @UseGuards(AdminGuard)
  @AdminAction('coupon.toggle')
  @Patch(':id/toggle')
  toggle(@Param('id') id: string) {
    return this.coupons.toggle(id);
  }
}
