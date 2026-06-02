import { Module, Global } from '@nestjs/common';
import { GstController } from './gst.controller';
import { GstService } from './gst.service';

// Global so Orders/Payments/Returns/Exchanges can post to the ledger without
// importing GstModule everywhere. SettingsModule (also @Global) supplies config.
@Global()
@Module({
  controllers: [GstController],
  providers: [GstService],
  exports: [GstService],
})
export class GstModule {}
