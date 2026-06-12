import { Module } from '@nestjs/common';
import { StockNotificationsController } from './stock-notifications.controller';
import { StockNotificationsService } from './stock-notifications.service';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [DatabaseModule, EmailModule],
  controllers: [StockNotificationsController],
  providers: [StockNotificationsService],
  exports: [StockNotificationsService],
})
export class StockNotificationsModule {}
