import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { HomepageContentService } from './homepage-content.service';
import { UpdateContentDto } from './dto/update-content.dto';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';

@Controller()
export class HomepageContentController {
  constructor(private service: HomepageContentService) {}

  /** Public — fetched by the frontend at build/load time. */
  @Get('homepage-content')
  getAll() {
    return this.service.getAll();
  }

  /** Admin-only — update a single key. */
  @UseGuards(AdminGuard)
  @AdminAction('homepage_content.update')
  @Patch('admin/homepage-content')
  update(@Body() dto: UpdateContentDto) {
    return this.service.update(dto.key, dto.value);
  }
}
