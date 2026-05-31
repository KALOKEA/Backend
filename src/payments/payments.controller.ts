import { Controller, Post, Body, Req } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentOrderDto } from './dto/create-payment-order.dto';
import { Public } from '../common/decorators/public.decorator';
import { Request } from 'express';

@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Post('create-order')
  createOrder(@Body() dto: CreatePaymentOrderDto) {
    return this.payments.createRazorpayOrder(dto.order_id);
  }

  @Public()
  @Post('webhook')
  webhook(@Req() req: Request) {
    return this.payments.handleWebhook(req as any);
  }
}
