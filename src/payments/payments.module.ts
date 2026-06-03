import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule], // OrdersService centralizes confirmation/receipt/invoice email
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
