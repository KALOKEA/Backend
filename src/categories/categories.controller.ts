import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';

@Controller('categories')
export class CategoriesController {
  constructor(private categories: CategoriesService) {}

  @Public()
  @Get('debug')
  async debug() {
    const { data, error } = await (this.categories as any).db.client
      .from('categories')
      .select('count')
      .limit(1);
    return {
      connected: !error,
      error: error ? { message: error.message, code: error.code, details: error.details, hint: error.hint } : null,
      data,
    };
  }

  @Public()
  @Get()
  findAll() {
    return this.categories.findAll();
  }

  @Public()
  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.categories.findBySlug(slug);
  }

  @Public()
  @Post('seed')
  seed() {
    return this.categories.seed();
  }

  @UseGuards(AdminGuard)
  @Post()
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @UseGuards(AdminGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: Partial<CreateCategoryDto>) {
    return this.categories.update(id, dto);
  }

  @UseGuards(AdminGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.categories.remove(id);
  }
}
