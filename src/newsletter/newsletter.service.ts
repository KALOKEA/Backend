import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);

  constructor(private db: DatabaseService, private email: EmailService) {}

  async subscribe(email: string) {
    const normalized = email.trim().toLowerCase();

    // Upsert so re-subscribing (or reactivating after unsubscribe) is idempotent
    // and never throws on the unique-email constraint.
    const { error } = await this.db.client
      .from('newsletter_subscribers')
      .upsert({ email: normalized, is_active: true }, { onConflict: 'email' });

    if (error) {
      this.logger.error(`Newsletter subscribe failed: ${error.message}`);
    } else {
      // Fire-and-forget welcome email (no-op if BREVO_API_KEY isn't set).
      await this.email.sendNewsletterWelcome(normalized).catch(() => {});
    }

    // Always respond the same way — avoids leaking whether an email already exists.
    return { message: 'Subscribed' };
  }

  /** Soft-delete: set is_active = false. Required by DPDP Act 2023 (MC-5). */
  async unsubscribe(email: string) {
    const normalized = email.trim().toLowerCase();
    const { error } = await this.db.client
      .from('newsletter_subscribers')
      .update({ is_active: false })
      .eq('email', normalized);
    if (error) {
      this.logger.error(`Newsletter unsubscribe failed: ${error.message}`);
    }
    // Always 200 — avoids leaking whether the email was subscribed.
    return { message: 'Unsubscribed successfully' };
  }
}
