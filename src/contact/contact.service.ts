import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { ContactDto } from './dto/contact.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(private email: EmailService) {}

  async submit(dto: ContactDto): Promise<{ message: string }> {
    // Forward the message to the store's support email via Brevo.
    // EmailService.sendContactForm is fire-and-forget-safe — if Brevo is not
    // configured the error is logged and the customer still gets a 200 so the
    // UI shows the success state.
    try {
      await this.email.sendContactForm({
        name: dto.name,
        email: dto.email,
        message: dto.message,
      });
    } catch (err: any) {
      this.logger.error(`Contact form email failed: ${err?.message}`);
    }

    return { message: 'Message received. We will respond within 24 hours.' };
  }
}
