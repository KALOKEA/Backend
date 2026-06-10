import { Module } from '@nestjs/common';
import { InstagramFeedController } from './instagram-feed.controller';
import { InstagramFeedService } from './instagram-feed.service';

@Module({
  controllers: [InstagramFeedController],
  providers: [InstagramFeedService],
})
export class InstagramFeedModule {}
