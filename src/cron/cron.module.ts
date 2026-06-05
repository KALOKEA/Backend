import { Module } from '@nestjs/common';
import { CronService } from './cron.service';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [DatabaseModule, EmailModule, SettingsModule],
  providers: [CronService],
})
export class CronModule {}
