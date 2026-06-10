import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface IgPost {
  id: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
}

// Cache posts for 15 minutes to avoid hammering the Graph API
const CACHE_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class InstagramFeedService {
  private readonly logger = new Logger(InstagramFeedService.name);
  private cache: IgPost[] | null = null;
  private cacheAt = 0;

  constructor(private config: ConfigService) {}

  async getFeed(): Promise<{ data: IgPost[] }> {
    const token = this.config.get<string>('INSTAGRAM_ACCESS_TOKEN');
    if (!token) {
      // Return empty data instead of throwing — frontend shows placeholders
      return { data: [] };
    }

    // Serve from cache if fresh
    if (this.cache && Date.now() - this.cacheAt < CACHE_TTL_MS) {
      return { data: this.cache };
    }

    try {
      const fields = 'id,media_type,media_url,thumbnail_url,permalink,timestamp';
      const url = `https://graph.instagram.com/me/media?fields=${fields}&limit=6&access_token=${token}`;
      const res = await fetch(url);

      if (!res.ok) {
        const err = await res.text();
        this.logger.warn(`Instagram Graph API error: ${err}`);
        return { data: this.cache ?? [] };
      }

      const json = await res.json();
      const posts: IgPost[] = (json.data || [])
        // Keep only IMAGE and CAROUSEL_ALBUM; videos only if they have a thumbnail
        .filter((p: IgPost) => p.media_type !== 'VIDEO' || p.thumbnail_url)
        .slice(0, 6);

      this.cache = posts;
      this.cacheAt = Date.now();
      return { data: posts };
    } catch (err) {
      this.logger.error('Failed to fetch Instagram feed', err);
      return { data: this.cache ?? [] };
    }
  }
}
