import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentOrderDto } from './dto/create-payment-order.dto';
import { RefundDto } from './dto/refund.dto';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { Request } from 'express';

@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Post('create-order')
  createOrder(@Body() dto: CreatePaymentOrderDto) {
    return this.payments.createRazorpayOrder(dto.order_id);
  }

  @UseGuards(AdminGuard)
  @AdminAction('payment.refund')
  @Post('refund')
  refund(@Body() dto: RefundDto) {
    return this.payments.refund(dto);
  }

  @Public()
  @Post('webhook')
  webhook(@Req() req: Request) {
    return this.payments.handleWebhook(req as any);
  }
}
