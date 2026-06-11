import { Controller, Get, Patch, Body, UseGuards, Header } from '@nestjs/common';
import { SiteContentService } from './site-content.service';
import { UpdateSiteContentDto } from './dto/update-site-content.dto';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('site-content')
@ApiBearerAuth('access-token')
@Controller()
export class SiteContentController {
  constructor(private service: SiteContentService) {}

  /** Public — all site content (about + footer) fetched by frontend. */
  @Public()
  @Get('site-content')
  @Header('Cache-Control', 'public, max-age=120, stale-while-revalidate=600')
  getAll() {
    return this.service.getAll();
  }

  /** Admin-only — update a single key. */
  @UseGuards(AdminGuard)
  @AdminAction('site_content.update')
  @Patch('admin/site-content')
  update(@Body() dto: UpdateSiteContentDto) {
    return this.service.update(dto.key, dto.value);
  }
}
