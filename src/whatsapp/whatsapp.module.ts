import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';

/**
 * @Global() — imported once in AppModule, WhatsAppService is then injectable
 * everywhere without each module needing to import WhatsAppModule explicitly.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
