import { Controller, Get, Patch, Body, UseGuards, Header } from '@nestjs/common';
import { HomepageContentService } from './homepage-content.service';
import { UpdateContentDto } from './dto/update-content.dto';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('homepage-content')
@ApiBearerAuth('access-token')
@Controller()
export class HomepageContentController {
  constructor(private service: HomepageContentService) {}

  /** Public — fetched by the frontend at build/load time. */
  @Public()
  @Get('homepage-content')
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  getAll() {
    return this.service.getAll();
  }

  /**
   * Aggregated homepage endpoint — CMS + categories + 8 newest products in one
   * request. Replaces 4 separate frontend API calls.
   */
  @Public()
  @Get('homepage')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  getHomepageData() {
    return this.service.getHomepageData();
  }

  /** Admin-only — update a single key. */
  @UseGuards(AdminGuard)
  @AdminAction('homepage_content.update')
  @Patch('admin/homepage-content')
  update(@Body() dto: UpdateContentDto) {
    return this.service.update(dto.key, dto.value);
  }
}
