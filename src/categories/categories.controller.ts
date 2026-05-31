import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { Public } from '../common/decorators/public.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { DatabaseService } from '../database/database.service';

@Controller('categories')
export class CategoriesController {
  constructor(
    private categories: CategoriesService,
    private db: DatabaseService,
  ) {}

  // TEMP DEBUG — remove after diagnosing
  @Public()
  @Get('raw-debug')
  async rawDebug() {
    const result = await this.db.client
      .from('categories')
      .select('*')
      .limit(3);
    return {
      data: result.data,
      error: result.error ? {
        message: result.error.message,
        code: (result.error as any).code,
        details: (result.error as any).details,
        hint: (result.error as any).hint,
      } : null,
      status: result.status,
      statusText: result.statusText,
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
