import { Controller, Get, Logger } from '@nestjs/common';
import { InstagramFeedService } from './instagram-feed.service';
import { Public } from '../common/decorators/public.decorator';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('instagram-feed')
@Controller('instagram-feed')
export class InstagramFeedController {
  constructor(private readonly svc: InstagramFeedService) {}

  /**
   * Returns up to 6 recent posts from the @kalokea.fashion Instagram account.
   * Requires INSTAGRAM_ACCESS_TOKEN in environment variables.
   * Returns 204 (no content) when the token is not configured.
   * Results are cached for 15 minutes server-side.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Get recent Instagram posts (public)' })
  @ApiResponse({ status: 200, description: 'Array of Instagram posts' })
  @ApiResponse({ status: 204, description: 'No Instagram token configured' })
  async getFeed() {
    return this.svc.getFeed();
  }
}
