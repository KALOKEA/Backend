import { Module } from '@nestjs/common';
import { CronService } from './cron.service';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [DatabaseModule, EmailModule],
  providers: [CronService],
})
export class CronModule {}
