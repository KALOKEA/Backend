import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Header, UseInterceptors } from '@nestjs/common';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private categories: CategoriesService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300000)
  findAll() {
    return this.categories.findAll();
  }

  @Public()
  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  findOne(@Param('slug') slug: string) {
    return this.categories.findBySlug(slug);
  }

  @UseGuards(AdminGuard)
  @AdminAction('category.seed')
  @Post('seed')
  seed() {
    return this.categories.seed();
  }

  @UseGuards(AdminGuard)
  @Get('admin/all')
  findAllAdmin() {
    return this.categories.findAllAdmin();
  }

  @UseGuards(AdminGuard)
  @AdminAction('category.create')
  @Post()
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @UseGuards(AdminGuard)
  @AdminAction('category.update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateCategoryDto>) {
    return this.categories.update(id, dto);
  }

  @UseGuards(AdminGuard)
  @AdminAction('category.deactivate')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.categories.remove(id);
  }
}
