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

  /** Admin: send a campaign email to all active subscribers */
  async sendCampaign(subject: string, body: string, previewText?: string) {
    // Fetch all active subscribers (no pagination — batch process)
    const { data: subscribers } = await this.db.client
      .from('newsletter_subscribers')
      .select('email')
      .eq('is_active', true);

    if (!subscribers || subscribers.length === 0) {
      return { sent: 0, failed: 0, message: 'No active subscribers' };
    }

    // Log the campaign
    const { data: campaign } = await this.db.client
      .from('newsletter_campaigns')
      .insert({
        subject,
        body_html: body,
        preview_text: previewText || null,
        recipient_count: subscribers.length,
        status: 'sending',
        sent_at: new Date().toISOString(),
      })
      .select()
      .single();

    let sent = 0;
    let failed = 0;

    // Send in batches of 20 to avoid rate limits
    const BATCH = 20;
    for (let i = 0; i < subscribers.length; i += BATCH) {
      const batch = subscribers.slice(i, i + BATCH);
      await Promise.allSettled(
        batch.map(async (sub: any) => {
          try {
            await this.email.sendNewsletterCampaign(sub.email, subject, body, previewText);
            sent++;
          } catch {
            failed++;
          }
        })
      );
    }

    // Update campaign status
    if (campaign) {
      await this.db.client
        .from('newsletter_campaigns')
        .update({ status: 'sent', sent_count: sent, failed_count: failed })
        .eq('id', campaign.id);
    }

    this.logger.log(`Campaign "${subject}" sent: ${sent} ok, ${failed} failed`);
    return { sent, failed, message: `Campaign sent to ${sent} subscribers` };
  }

  /** Admin: list past campaigns */
  async listCampaigns(page = 1, limit = 20) {
    const from = (page - 1) * limit;
    const { data, count } = await this.db.client
      .from('newsletter_campaigns')
      .select('*', { count: 'exact' })
      .order('sent_at', { ascending: false })
      .range(from, from + limit - 1);
    return {
      data: data || [],
      meta: { total: count ?? 0, page, limit, total_pages: Math.ceil((count ?? 0) / limit) },
    };
  }

  /** Admin: stats summary */
  async getStats() {
    const [{ count: total }, { count: active }] = await Promise.all([
      this.db.client.from('newsletter_subscribers').select('id', { count: 'exact' }),
      this.db.client.from('newsletter_subscribers').select('id', { count: 'exact' }).eq('is_active', true),
    ]);
    const { count: campaigns } = await this.db.client
      .from('newsletter_campaigns')
      .select('id', { count: 'exact' });
    return {
      total_subscribers: total ?? 0,
      active_subscribers: active ?? 0,
      unsubscribed: (total ?? 0) - (active ?? 0),
      total_campaigns: campaigns ?? 0,
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
