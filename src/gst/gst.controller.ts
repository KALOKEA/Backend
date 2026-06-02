import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { GstService } from './gst.service';
import { AdminGuard } from '../common/guards/admin.guard';

@UseGuards(AdminGuard)
@Controller('gst')
export class GstController {
  constructor(private gst: GstService) {}

  /** Immutable ledger rows (sale/return/exchange) for a date range. */
  @Get('ledger')
  ledger(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: string,
  ) {
    return this.gst.getLedger({ from, to, type });
  }

  /** Aggregated, rate-wise summary for the dashboard. */
  @Get('summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.gst.getSummary({ from, to });
  }

  /** Per-transaction CSV (opens in Excel) — full ledger for the CA. */
  @Get('export/transactions')
  async exportTransactions(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: string,
  ) {
    const csv = await this.gst.exportLedgerCsv({ from, to, type });
    this.sendCsv(res, `gst-transactions${this.suffix(from, to)}.csv`, csv);
  }

  /** Rate-wise summary CSV (GSTR-1 style) for filing. */
  @Get('export/summary')
  async exportSummary(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.gst.exportSummaryCsv({ from, to });
    this.sendCsv(res, `gst-summary${this.suffix(from, to)}.csv`, csv);
  }

  private suffix(from?: string, to?: string): string {
    if (from && to) return `-${from}_to_${to}`;
    if (from) return `-from-${from}`;
    if (to) return `-to-${to}`;
    return '';
  }

  private sendCsv(res: Response, filename: string, csv: string) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // BOM so Excel reads UTF-8 / the ₹ glyph correctly.
    res.send('﻿' + csv);
  }
}
