import { Controller, Post, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ContactService } from './contact.service';
import { ContactDto } from './dto/contact.dto';
import { Public } from '../common/decorators/public.decorator';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(private contact: ContactService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 300000 } }) // 5 per 5 minutes — spam guard
  @Post()
  submit(@Body() dto: ContactDto) {
    return this.contact.submit(dto);
  }
}
