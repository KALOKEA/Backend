import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);

  constructor(private db: DatabaseService, private email: EmailService) {}

  async subscribe(email: string) {
    const normalized = email.trim().toLowerCase();
    const { error } = await this.db.client
      .from('newsletter_subscribers')
      .upsert({ email: normalized, is_active: true }, { onConflict: 'email' });
    if (error) {
      this.logger.error(`Newsletter subscribe failed: ${error.message}`);
    } else {
      await this.email.sendNewsletterWelcome(normalized).catch(() => {});
    }
    return { message: 'Subscribed' };
  }

  async unsubscribe(email: string) {
    const normalized = email.trim().toLowerCase();
    const { error } = await this.db.client
      .from('newsletter_subscribers')
      .update({ is_active: false })
      .eq('email', normalized);
    if (error) {
      this.logger.error(`Newsletter unsubscribe failed: ${error.message}`);
    }
    return { message: 'Unsubscribed successfully' };
  }

  async listSubscribers(page = 1, limit = 50, active?: string) {
    const from = (page - 1) * limit;
    let q = this.db.client
      .from('newsletter_subscribers')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (active === 'true') q = q.eq('is_active', true);
    if (active === 'false') q = q.eq('is_active', false);

    const { data, count } = await q;
    return {
      data: data || [],
      meta: { total: count ?? 0, page, limit, total_pages: Math.ceil((count ?? 0) / limit) },
    };
  }

  async exportCsv(): Promise<string> {
    const { data } = await this.db.client
      .from('newsletter_subscribers')
      .select('email, is_active, created_at')
      .order('created_at', { ascending: false });

    const rows = data || [];
    const header = 'email,status,subscribed_at';
    const lines = rows.map((r: any) =>
      `${r.email},${r.is_active ? 'active' : 'unsubscribed'},${r.created_at}`
    );
    return [header, ...lines].join('\n');
  }
}
