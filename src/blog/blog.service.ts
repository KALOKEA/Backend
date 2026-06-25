import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateBlogPostDto } from './dto/create-blog-post.dto';
import { UpdateBlogPostDto } from './dto/update-blog-post.dto';

/** Columns returned to the public storefront. */
const PUBLIC_COLUMNS =
  'id, slug, title, heading, heading_italic, eyebrow, excerpt, description, content, cover_image, keywords, reading_time, author, published_at, updated_at';

@Injectable()
export class BlogService {
  constructor(private db: DatabaseService) {}

  /** URL-safe slug from an arbitrary title. */
  private slugify(input: string): string {
    return (input || '')
      .toLowerCase()
      .trim()
      .replace(/['"]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 200);
  }

  private normaliseKeywords(keywords?: string[]): string[] {
    if (!Array.isArray(keywords)) return [];
    return keywords
      .map((k) => (typeof k === 'string' ? k.trim() : ''))
      .filter(Boolean)
      .slice(0, 30);
  }

  // ── Public (storefront) ────────────────────────────────────────────────────

  /** All published posts, newest first. */
  async findAllPublished() {
    const { data } = await this.db.client
      .from('blog_posts')
      .select(PUBLIC_COLUMNS)
      .eq('status', 'published')
      .order('published_at', { ascending: false, nullsFirst: false });
    return data || [];
  }

  /** A single published post by slug. */
  async findOnePublished(slug: string) {
    const { data } = await this.db.client
      .from('blog_posts')
      .select(PUBLIC_COLUMNS)
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle();
    if (!data) throw new NotFoundException('Post not found');
    return data;
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  /** Every post (draft + published) for the admin list. */
  async findAllAdmin() {
    const { data } = await this.db.client
      .from('blog_posts')
      .select('*')
      .order('updated_at', { ascending: false });
    return data || [];
  }

  /** A single post by id (admin editor). */
  async findOneAdmin(id: string) {
    const { data } = await this.db.client
      .from('blog_posts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!data) throw new NotFoundException('Post not found');
    return data;
  }

  async create(dto: CreateBlogPostDto) {
    const title = dto.title?.trim();
    if (!title) throw new BadRequestException('Title is required');

    const slug = (dto.slug?.trim() ? this.slugify(dto.slug) : this.slugify(title));
    if (!slug) throw new BadRequestException('Could not derive a valid slug — please set one manually');

    // Ensure slug uniqueness up front for a friendly error (the DB also enforces it).
    const { data: existing } = await this.db.client
      .from('blog_posts')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (existing) throw new ConflictException(`A post with the slug "${slug}" already exists`);

    const status = dto.status === 'published' ? 'published' : 'draft';
    const row: Record<string, any> = {
      slug,
      title,
      heading: dto.heading?.trim() || title,
      heading_italic: dto.heading_italic?.trim() || null,
      eyebrow: dto.eyebrow?.trim() || null,
      excerpt: dto.excerpt?.trim() || null,
      description: dto.description?.trim() || null,
      content: dto.content ?? null,
      cover_image: dto.cover_image?.trim() || null,
      keywords: this.normaliseKeywords(dto.keywords),
      reading_time: dto.reading_time?.trim() || null,
      author: dto.author?.trim() || null,
      status,
      published_at: status === 'published' ? new Date().toISOString() : null,
    };

    const { data, error } = await this.db.client
      .from('blog_posts')
      .insert(row)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async update(id: string, dto: UpdateBlogPostDto) {
    const { data: current } = await this.db.client
      .from('blog_posts')
      .select('id, status, published_at')
      .eq('id', id)
      .maybeSingle();
    if (!current) throw new NotFoundException('Post not found');

    const updates: Record<string, any> = {};

    if (dto.title !== undefined) {
      const t = dto.title.trim();
      if (!t) throw new BadRequestException('Title cannot be empty');
      updates.title = t;
    }

    if (dto.slug !== undefined) {
      const slug = this.slugify(dto.slug);
      if (!slug) throw new BadRequestException('Invalid slug');
      // Block collisions with a DIFFERENT post.
      const { data: clash } = await this.db.client
        .from('blog_posts')
        .select('id')
        .eq('slug', slug)
        .neq('id', id)
        .maybeSingle();
      if (clash) throw new ConflictException(`A post with the slug "${slug}" already exists`);
      updates.slug = slug;
    }

    if (dto.heading !== undefined) updates.heading = dto.heading?.trim() || null;
    if (dto.heading_italic !== undefined) updates.heading_italic = dto.heading_italic?.trim() || null;
    if (dto.eyebrow !== undefined) updates.eyebrow = dto.eyebrow?.trim() || null;
    if (dto.excerpt !== undefined) updates.excerpt = dto.excerpt?.trim() || null;
    if (dto.description !== undefined) updates.description = dto.description?.trim() || null;
    if (dto.content !== undefined) updates.content = dto.content ?? null;
    if (dto.cover_image !== undefined) updates.cover_image = dto.cover_image?.trim() || null;
    if (dto.keywords !== undefined) updates.keywords = this.normaliseKeywords(dto.keywords);
    if (dto.reading_time !== undefined) updates.reading_time = dto.reading_time?.trim() || null;
    if (dto.author !== undefined) updates.author = dto.author?.trim() || null;

    if (dto.status !== undefined) {
      const status = dto.status === 'published' ? 'published' : 'draft';
      updates.status = status;
      // Stamp published_at the first time a post goes live; keep it on re-saves.
      if (status === 'published' && !current.published_at) {
        updates.published_at = new Date().toISOString();
      }
    }

    if (Object.keys(updates).length === 0) {
      return this.findOneAdmin(id);
    }

    const { data, error } = await this.db.client
      .from('blog_posts')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException(error?.message || 'Update failed');
    return data;
  }

  async remove(id: string) {
    const { data: existing } = await this.db.client
      .from('blog_posts')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (!existing) throw new NotFoundException('Post not found');

    const { error } = await this.db.client.from('blog_posts').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { message: 'Post deleted' };
  }
}
