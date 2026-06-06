import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface CmsPage {
  slug: string;
  title: string;
  content: string;
  meta_description?: string;
  updated_at: string;
}

@Injectable()
export class CmsService {
  constructor(private db: DatabaseService) {}

  async findAll(): Promise<CmsPage[]> {
    const { data, error } = await this.db.client
      .from('cms_pages')
      .select('slug, title, content, meta_description, updated_at')
      .order('slug');
    if (error) throw error;
    return data || [];
  }

  async findOne(slug: string): Promise<CmsPage> {
    const { data, error } = await this.db.client
      .from('cms_pages')
      .select('slug, title, content, meta_description, updated_at')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException(`Page "${slug}" not found`);
    return data;
  }

  async update(slug: string, dto: { title?: string; content?: string; meta_description?: string }): Promise<CmsPage> {
    const { error } = await this.db.client
      .from('cms_pages')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('slug', slug);
    if (error) throw error;
    return this.findOne(slug);
  }
}
