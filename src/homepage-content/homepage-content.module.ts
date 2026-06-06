import { Module } from '@nestjs/common';
import { HomepageContentController } from './homepage-content.controller';
import { HomepageContentService } from './homepage-content.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [HomepageContentController],
  providers: [HomepageContentService],
})
export class HomepageContentModule {}
