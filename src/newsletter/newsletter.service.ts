import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
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
      throw new InternalServerErrorException('Failed to subscribe. Please try again.');
    }
    await this.email.sendNewsletterWelcome(normalized).catch(() => {});
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
      throw new InternalServerErrorException('Failed to unsubscribe. Please try again.');
    }
    return { message: 'Unsubscribed successfully' };
  }

  async listSubscribers(page = 1, limit = 50, active?: string) {
    const offset = (page - 1) * limit;

    // Mirror getStats() exactly: use { count: 'exact' } option, no .order(), no .range().
    // Bare select() + .order() (without count option) returns a Supabase error in this
    // client version. Sort and paginate in JS instead.
    const { data: rawData, error } = await this.db.client
      .from('newsletter_subscribers')
      .select('id, email, is_active, created_at', { count: 'exact' });

    if (error) {
      this.logger.error(`listSubscribers failed: ${JSON.stringify(error)}`);
      throw new InternalServerErrorException('Failed to load subscribers');
    }

    // Sort newest first in JS
    let all = ((rawData || []) as any[]).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    // JS filter for active/inactive
    if (active === 'true')  all = all.filter((s: any) =>  s.is_active);
    if (active === 'false') all = all.filter((s: any) => !s.is_active);

    const total = all.length;
    const subs = all.slice(offset, offset + limit);

    // Enrich with name from users table — non-fatal if it fails
    const emails = subs.map((s: any) => s.email).filter(Boolean);
    const nameByEmail: Record<string, string> = {};
    if (emails.length) {
      try {
        const { data: users, error: usersErr } = await this.db.client
          .from('users')
          .select('name, email')
          .in('email', emails);
        if (usersErr) {
          this.logger.warn(`users enrichment failed: ${usersErr.message}`);
        }
        for (const u of users || []) {
          if (u.email) nameByEmail[String(u.email).toLowerCase()] = u.name || '';
        }
      } catch (e: any) {
        this.logger.warn(`users enrichment threw: ${e?.message}`);
      }
    }

    const enriched = subs.map((s: any) => ({
      ...s,
      name: nameByEmail[String(s.email || '').toLowerCase()] || null,
    }));

    return {
      data: enriched,
      meta: { total, page, limit, total_pages: Math.ceil(total / limit) },
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
    // Use { count: 'exact' } to match the known-working query pattern (no bare select+order)
    const { data } = await this.db.client
      .from('newsletter_subscribers')
      .select('email, is_active, created_at', { count: 'exact' });

    const rows = ((data || []) as any[]).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    // Enrich with registered user name where available
    const emails = rows.map((r: any) => r.email).filter(Boolean);
    const nameByEmail: Record<string, string> = {};
    if (emails.length) {
      const { data: users } = await this.db.client
        .from('users').select('email, name').in('email', emails);
      for (const u of users || []) {
        if (u.email) nameByEmail[String(u.email).toLowerCase()] = u.name || '';
      }
    }

    const esc = (v: string) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = 'name,email,status,subscribed_at';
    const lines = rows.map((r: any) => [
      nameByEmail[String(r.email || '').toLowerCase()] || '',
      r.email,
      r.is_active ? 'active' : 'unsubscribed',
      r.created_at,
    ].map(esc).join(','));
    return [header, ...lines].join('\n');
  }
}
