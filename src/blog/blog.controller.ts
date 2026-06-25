import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Header } from '@nestjs/common';
import { BlogService } from './blog.service';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';
import { Public } from '../common/decorators/public.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { AdminAction } from '../common/decorators/admin-action.decorator';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('blog')
@ApiBearerAuth('access-token')
@Permission('blog')
@Controller('blog')
export class BlogController {
  constructor(private blog: BlogService) {}

  // ── Public (storefront) ────────────────────────────────────────────────────

  /** Public: list published posts (newest first). */
  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=120, stale-while-revalidate=600')
  findAllPublished() {
    return this.blog.findAllPublished();
  }

  // ── Admin ──────────────────────────────────────────────────────────────────
  // 'admin/all' MUST be declared before ':slug' so the literal segment isn't
  // captured by the slug route.

  /** Admin: every post (draft + published). */
  @UseGuards(PermissionsGuard)
  @Get('admin/all')
  findAllAdmin() {
    return this.blog.findAllAdmin();
  }

  /** Admin: single post by id (editor). */
  @UseGuards(PermissionsGuard)
  @Get('admin/:id')
  findOneAdmin(@Param('id') id: string) {
    return this.blog.findOneAdmin(id);
  }

  /** Public: a single published post by slug. */
  @Public()
  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=120, stale-while-revalidate=600')
  findOnePublished(@Param('slug') slug: string) {
    return this.blog.findOnePublished(slug);
  }

  @UseGuards(PermissionsGuard)
  @AdminAction('blog.create')
  @Post()
  create(@Body() dto: CreateBlogPostDto) {
    return this.blog.create(dto);
  }

  @UseGuards(PermissionsGuard)
  @AdminAction('blog.update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBlogPostDto) {
    return this.blog.update(id, dto);
  }

  @UseGuards(PermissionsGuard)
  @AdminAction('blog.delete')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.blog.remove(id);
  }
}
