import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ShiprocketService } from './shiprocket.service';
import { ShiprocketController } from './shiprocket.controller';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [ConfigModule, DatabaseModule, EmailModule],
  controllers: [ShiprocketController],
  providers: [ShiprocketService],
  exports: [ShiprocketService],
})
export class ShiprocketModule {}
