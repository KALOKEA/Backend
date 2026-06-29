import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { GstService } from './gst.service';
import { AdminGuard } from '../common/guards/admin.guard';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@UseGuards(AdminGuard)
@ApiTags('gst')
@ApiBearerAuth('access-token')
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

  /** Cash-flow / settlement: collected vs COD-outstanding vs refunded. */
  @Get('cashflow')
  cashflow(@Query('from') from?: string, @Query('to') to?: string) {
    return this.gst.getCashflowSummary({ from, to });
  }

  /** Per-transaction CSV (opens in Excel) — GSTR-1 detail format for the CA. */
  @Get('export/transactions')
  async exportTransactions(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: string,
  ) {
    const csv = await this.gst.exportLedgerCsv({ from, to, type });
    this.sendCsv(res, `KALOKEA-GST${this.suffix(from, to)}.csv`, csv);
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

  /** GSTR-1 Section 12 — HSN-wise monthly summary. month = 'YYYY-MM' */
  @Get('export/gstr1/:month')
  async exportGstr1(
    @Res() res: Response,
    @Param('month') month: string,
  ) {
    const csv = await this.gst.exportGstr1Monthly(month);
    this.sendCsv(res, `GSTR1-HSN-${month}.csv`, csv);
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
