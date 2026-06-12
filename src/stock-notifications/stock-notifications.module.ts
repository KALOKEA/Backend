import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StockNotificationsController } from './stock-notifications.controller';
import { StockNotificationsService } from './stock-notifications.service';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [DatabaseModule, EmailModule, ConfigModule],
  controllers: [StockNotificationsController],
  providers: [StockNotificationsService],
  exports: [StockNotificationsService],
})
export class StockNotificationsModule {}
