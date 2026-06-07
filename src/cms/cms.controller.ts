import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common';
import { CmsService } from './cms.service';
import { AdminGuard } from '../common/guards/admin.guard';
import { Public } from '../common/decorators/public.decorator';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('homepage-content')
@ApiBearerAuth('access-token')
@Controller('cms')
export class CmsController {
  constructor(private cms: CmsService) {}

  /** Public: list all pages (slug + title only, for navigation) */
  @Public()
  @Get()
  findAll() {
    return this.cms.findAll();
  }

  /** Public: get single page by slug */
  @Public()
  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.cms.findOne(slug);
  }

  /** Admin: update page content */
  @UseGuards(AdminGuard)
  @AdminAction('cms.update')
  @Put(':slug')
  update(
    @Param('slug') slug: string,
    @Body() body: { title?: string; content?: string; meta_description?: string },
  ) {
    return this.cms.update(slug, body);
  }
}
