import { Controller, Post, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { NewsletterService } from './newsletter.service';
import { SubscribeDto } from './dto/subscribe.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('newsletter')
export class NewsletterController {
  constructor(private newsletter: NewsletterService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // light abuse protection
  @Post('subscribe')
  subscribe(@Body() dto: SubscribeDto) {
    return this.newsletter.subscribe(dto.email);
  }
}
