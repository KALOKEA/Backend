import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { FeedService } from './feed.service';
import { Public } from '../common/decorators/public.decorator';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('feed')
@Controller('feed')
export class FeedController {
  constructor(private feed: FeedService) {}

  // Public XML — submit this URL in Google Merchant Center as a scheduled feed.
  // Uses @Res directly so the raw XML bypasses the JSON TransformInterceptor.
  @Public()
  @Get('google.xml')
  async google(@Res() res: Response) {
    const xml = await this.feed.googleFeed();
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  }
}
