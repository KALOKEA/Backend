import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentOrderDto } from './dto/create-payment-order.dto';
import { RefundDto } from './dto/refund.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Request } from 'express';

@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  /** Create a Razorpay order for an existing Kalokea order.
   *  Ownership check: the requesting user must own the order (SEC-1 / BOLA fix). */
  @Post('create-order')
  createOrder(@Body() dto: CreatePaymentOrderDto, @CurrentUser() user: any) {
    return this.payments.createRazorpayOrder(dto.order_id, user?.id);
  }

  @UseGuards(AdminGuard)
  @AdminAction('payment.refund')
  @Post('refund')
  refund(@Body() dto: RefundDto) {
    return this.payments.refund(dto);
  }

  /**
   * Client-side payment signature verification.
   * Called from the Razorpay handler() callback before showing the success page.
   * Public because the user may not yet have a valid access token at this point.
   */
  @Public()
  @Post('verify')
  verifyPayment(@Body() dto: VerifyPaymentDto) {
    return this.payments.verifyPayment(dto);
  }

  @Public()
  @Post('webhook')
  webhook(@Req() req: Request) {
    return this.payments.handleWebhook(req as any);
  }
}
