import { Module } from '@nestjs/common';
import { CmsService } from './cms.service';
import { CmsController } from './cms.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [CmsController],
  providers: [CmsService],
  exports: [CmsService],
})
export class CmsModule {}
