import { Module } from '@nestjs/common';
import { CronService } from './cron.service';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';
import { StockNotificationsModule } from '../stock-notifications/stock-notifications.module';

@Module({
  imports: [DatabaseModule, EmailModule, StockNotificationsModule],
  providers: [CronService],
})
export class CronModule {}
