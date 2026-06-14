import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SettingsService } from '../settings/settings.service';

/**
 * Central GST engine. All money is integer PAISE.
 *
 * Pricing model = EXCLUSIVE: GST is added on top of the (pre-tax) variant price.
 * Each product carries its own gst_rate (per-HSN slab); store_settings.gst_rate
 * is the fallback. Intra-state supply (buyer state == seller state) splits into
 * CGST + SGST; inter-state is IGST.
 *
 * gst_ledger is the immutable accounting record: one row per taxable line.
 * Sales are positive, returns negative, exchanges = one negative + one positive.
 */
@Injectable()
export class GstService {
  private readonly logger = new Logger(GstService.name);

  constructor(
    private db: DatabaseService,
    private settings: SettingsService,
  ) {}

  // ── Pure helpers ─────────────────────────────────────────────────────────

  /** Product rate (per-HSN) else the store default. */
  resolveRate(productRate: number | null | undefined, defaultRate: number): number {
    const r = Number(productRate);
    return Number.isFinite(r) && r > 0 ? r : Number(defaultRate) || 0;
  }

  /** GST amount (paise) on an exclusive taxable value. */
  taxOn(taxableValue: number, rate: number): number {
    return Math.round((taxableValue * rate) / 100);
  }

  /** Split a tax amount (paise, signed) into CGST/SGST/IGST by place of supply. */
  splitTax(tax: number, intraState: boolean): { cgst: number; sgst: number; igst: number } {
    if (intraState) {
      // round() on the signed value keeps cgst+sgst === tax exactly.
      const cgst = Math.round(tax / 2);
      return { cgst, sgst: tax - cgst, igst: 0 };
    }
    return { cgst: 0, sgst: 0, igst: tax };
  }

  isIntraState(buyerState?: string | null, sellerState?: string | null): boolean {
    const b = String(buyerState || '').trim().toLowerCase();
    const s = String(sellerState || '').trim().toLowerCase();
    return !!s && s === b;
  }

  // ── Ledger writers ───────────────────────────────────────────────────────

  /**
   * Post one 'sale' ledger row per order line. Idempotent: if a sale row for
   * this order already exists (duplicate webhook, retry) it is skipped.
   * Reads the GST snapshot already persisted on the order + order_items.
   */
  async postSaleLedger(orderId: string): Promise<void> {
    const { data: order } = await this.db.client
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .single();
    if (!order) return;

    const { count } = await this.db.client
      .from('gst_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId)
      .eq('txn_type', 'sale');
    if (count && count > 0) return; // already posted

    const addr = order.address_snapshot || {};
    const intra = order.is_intra_state ?? this.isIntraState(addr.state, null);
    const customerName = order.company_name || addr.name || 'Customer';

    const rows = (order.order_items || []).map((it: any) => {
      const taxable = Number(it.taxable_value) || 0;
      const gst = Number(it.gst_amount) || 0;
      const { cgst, sgst, igst } = this.splitTax(gst, intra);
      return {
        txn_type: 'sale',
        txn_date: order.created_at,
        order_id: order.id,
        order_item_id: it.id,
        order_number: order.order_number,
        hsn_code: it.hsn_code || null,
        description: it.snapshot_name,
        quantity: it.quantity,
        gst_rate: Number(it.gst_rate) || 0,
        place_of_supply: order.place_of_supply || addr.state || null,
        is_intra_state: intra,
        taxable_value: taxable,
        cgst,
        sgst,
        igst,
        total_gst: gst,
        gross: taxable + gst,
        customer_name: customerName,
        customer_gstin: order.gstin || null,
      };
    });
    if (!rows.length) return;

    const { error } = await this.db.client.from('gst_ledger').insert(rows);
    if (error && error.code !== '23505') {
      this.logger.error(`postSaleLedger failed: ${error.message}`);
    }
  }

  /**
   * Post a negative 'return' ledger row reversing a returned line's GST.
   * Pulls the original line's snapshot so the reversal exactly mirrors the sale.
   * Idempotent on return_id.
   */
  async postReturnLedger(returnId: string): Promise<void> {
    const { count } = await this.db.client
      .from('gst_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('return_id', returnId)
      .eq('txn_type', 'return');
    if (count && count > 0) return;

    const { data: ret } = await this.db.client
      .from('returns')
      .select('*, orders(order_number, address_snapshot, is_intra_state, place_of_supply, company_name, gstin)')
      .eq('id', returnId)
      .single();
    if (!ret) return;
    const order = ret.orders as any;
    if (!order) return;

    // Identify the returned line. If order_item_id is set, reverse just that
    // line; otherwise reverse the whole order (full return).
    let items: any[] = [];
    if (ret.order_item_id) {
      const { data } = await this.db.client
        .from('order_items').select('*').eq('id', ret.order_item_id);
      items = data || [];
    } else {
      const { data } = await this.db.client
        .from('order_items').select('*').eq('order_id', ret.order_id);
      items = data || [];
    }
    if (!items.length) return;

    const addr = order.address_snapshot || {};
    const intra = order.is_intra_state ?? this.isIntraState(addr.state, null);
    const customerName = order.company_name || addr.name || 'Customer';

    const rows = items.map((it: any) => {
      const taxable = -(Number(it.taxable_value) || 0);
      const gst = -(Number(it.gst_amount) || 0);
      const { cgst, sgst, igst } = this.splitTax(gst, intra);
      return {
        txn_type: 'return',
        txn_date: ret.updated_at || new Date().toISOString(),
        order_id: ret.order_id,
        order_item_id: it.id,
        return_id: ret.id,
        order_number: order.order_number,
        hsn_code: it.hsn_code || null,
        description: it.snapshot_name,
        quantity: -(it.quantity || 0),
        gst_rate: Number(it.gst_rate) || 0,
        place_of_supply: order.place_of_supply || addr.state || null,
        is_intra_state: intra,
        taxable_value: taxable,
        cgst,
        sgst,
        igst,
        total_gst: gst,
        gross: taxable + gst,
        customer_name: customerName,
        customer_gstin: order.gstin || null,
      };
    });

    const { error } = await this.db.client.from('gst_ledger').insert(rows);
    if (error && error.code !== '23505') {
      this.logger.error(`postReturnLedger failed: ${error.message}`);
    }
  }

  /**
   * Post the GST impact of a completed exchange: a negative line for the
   * returned (original) item and a positive line for the new item. Net effect
   * equals exchange.gst_difference. Idempotent on exchange_id.
   */
  async postExchangeLedger(exchangeId: string): Promise<void> {
    const { count } = await this.db.client
      .from('gst_ledger')
      .select('id', { count: 'exact', head: true })
      .eq('exchange_id', exchangeId)
      .eq('txn_type', 'exchange');
    if (count && count > 0) return;

    const { data: ex } = await this.db.client
      .from('exchanges')
      .select('*, orders(order_number, address_snapshot, is_intra_state, place_of_supply, company_name, gstin), order_items(*)')
      .eq('id', exchangeId)
      .single();
    if (!ex) return;
    const order = ex.orders as any;
    const origItem = ex.order_items as any;
    if (!order || !origItem) return;

    const addr = order.address_snapshot || {};
    const intra = order.is_intra_state ?? this.isIntraState(addr.state, null);
    const customerName = order.company_name || addr.name || 'Customer';
    const now = ex.updated_at || new Date().toISOString();

    // Returned (original) line — reverse its stored GST snapshot.
    const origTaxable = -(Number(origItem.taxable_value) || 0);
    const origGst = -(Number(origItem.gst_amount) || 0);
    const origSplit = this.splitTax(origGst, intra);

    // New item line — taxable = new pre-tax price * qty; GST at original line's rate.
    const rate = Number(origItem.gst_rate) || 0;
    const newTaxable = Number(ex.new_price) || 0; // new_price already qty-inclusive snapshot
    const newGst = this.taxOn(newTaxable, rate);
    const newSplit = this.splitTax(newGst, intra);

    const base = {
      txn_type: 'exchange',
      txn_date: now,
      order_id: ex.order_id,
      exchange_id: ex.id,
      order_number: order.order_number,
      gst_rate: rate,
      place_of_supply: order.place_of_supply || addr.state || null,
      is_intra_state: intra,
      customer_name: customerName,
      customer_gstin: order.gstin || null,
    };

    const rows = [
      {
        ...base,
        order_item_id: origItem.id,
        hsn_code: origItem.hsn_code || null,
        description: `Exchange out: ${origItem.snapshot_name}`,
        quantity: -(origItem.quantity || 1),
        taxable_value: origTaxable,
        ...origSplit,
        total_gst: origGst,
        gross: origTaxable + origGst,
      },
      {
        ...base,
        order_item_id: origItem.id,
        hsn_code: origItem.hsn_code || null,
        description: `Exchange in: ${ex.new_snapshot_name || origItem.snapshot_name}`,
        quantity: origItem.quantity || 1,
        taxable_value: newTaxable,
        ...newSplit,
        total_gst: newGst,
        gross: newTaxable + newGst,
      },
    ];

    const { error } = await this.db.client.from('gst_ledger').insert(rows);
    if (error && error.code !== '23505') {
      this.logger.error(`postExchangeLedger failed: ${error.message}`);
    }
  }

  // ── Dashboard / export ───────────────────────────────────────────────────

  /** Raw ledger rows for a date range (and optional type), newest first. */
  async getLedger(opts: { from?: string; to?: string; type?: string }) {
    let q = this.db.client
      .from('gst_ledger')
      .select('*')
      .order('txn_date', { ascending: false });
    if (opts.from) q = q.gte('txn_date', this.dayStart(opts.from));
    if (opts.to) q = q.lt('txn_date', this.dayEnd(opts.to));
    if (opts.type && ['sale', 'return', 'exchange'].includes(opts.type)) {
      q = q.eq('txn_type', opts.type);
    }
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  /**
   * Aggregated summary for a date range: net totals, a per-rate (HSN slab)
   * breakup, and split by transaction type. This is the GSTR-ready view.
   */
  async getSummary(opts: { from?: string; to?: string }) {
    const rows = await this.getLedger(opts);
    const acc = (r: any[]) => r.reduce(
      (s, x) => {
        s.taxable += Number(x.taxable_value) || 0;
        s.cgst += Number(x.cgst) || 0;
        s.sgst += Number(x.sgst) || 0;
        s.igst += Number(x.igst) || 0;
        s.total_gst += Number(x.total_gst) || 0;
        s.gross += Number(x.gross) || 0;
        return s;
      },
      { taxable: 0, cgst: 0, sgst: 0, igst: 0, total_gst: 0, gross: 0 },
    );

    const byRateMap = new Map<number, any[]>();
    for (const r of rows) {
      const rate = Number(r.gst_rate) || 0;
      if (!byRateMap.has(rate)) byRateMap.set(rate, []);
      byRateMap.get(rate)!.push(r);
    }
    const by_rate = [...byRateMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rate, r]) => ({ gst_rate: rate, ...acc(r) }));

    return {
      from: opts.from || null,
      to: opts.to || null,
      totals: acc(rows),
      by_type: {
        sale: acc(rows.filter((r) => r.txn_type === 'sale')),
        return: acc(rows.filter((r) => r.txn_type === 'return')),
        exchange: acc(rows.filter((r) => r.txn_type === 'exchange')),
      },
      by_rate,
      count: rows.length,
    };
  }

  /** Per-transaction CSV (one row per ledger line) for the CA. */
  async exportLedgerCsv(opts: { from?: string; to?: string; type?: string }): Promise<string> {
    const rows = await this.getLedger(opts);
    const header = [
      'Date', 'Type', 'Invoice No', 'Customer', 'GSTIN', 'HSN', 'Description',
      'Qty', 'Place of Supply', 'Intra-State', 'GST Rate %',
      'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total GST', 'Gross',
    ];
    const lines = rows.map((r: any) => [
      this.csvDate(r.txn_date),
      r.txn_type,
      r.order_number || '',
      r.customer_name || '',
      r.customer_gstin || '',
      r.hsn_code || '',
      r.description || '',
      r.quantity,
      r.place_of_supply || '',
      r.is_intra_state ? 'Yes' : 'No',
      Number(r.gst_rate) || 0,
      this.rupees(r.taxable_value),
      this.rupees(r.cgst),
      this.rupees(r.sgst),
      this.rupees(r.igst),
      this.rupees(r.total_gst),
      this.rupees(r.gross),
    ]);
    return this.toCsv([header, ...lines]);
  }

  /** Rate-wise summary CSV (GSTR-1 style) for the CA. */
  async exportSummaryCsv(opts: { from?: string; to?: string }): Promise<string> {
    const summary = await this.getSummary(opts);
    const header = ['GST Rate %', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Total GST', 'Gross'];
    const lines = summary.by_rate.map((r) => [
      r.gst_rate,
      this.rupees(r.taxable), this.rupees(r.cgst), this.rupees(r.sgst),
      this.rupees(r.igst), this.rupees(r.total_gst), this.rupees(r.gross),
    ]);
    const t = summary.totals;
    lines.push([
      'TOTAL', this.rupees(t.taxable), this.rupees(t.cgst), this.rupees(t.sgst),
      this.rupees(t.igst), this.rupees(t.total_gst), this.rupees(t.gross),
    ]);
    return this.toCsv([header, ...lines]);
  }


  /**
   * GSTR-1 monthly HSN-wise summary (Section 12 — HSN Summary of Outward Supplies).
   * Format: HSN Code | Description | UOM | Total Qty | Taxable Value |
   *         Integrated Tax | Central Tax | State/UT Tax | Cess
   * month: "YYYY-MM" e.g. "2026-05"
   */
  async exportGstr1Monthly(month: string): Promise<string> {
    // Parse month → date range in IST
    const [year, mon] = month.split('-').map(Number);
    if (!year || !mon || mon < 1 || mon > 12) {
      throw new Error(`Invalid month format: "${month}" — use YYYY-MM`);
    }
    const from = new Date(`${month}-01T00:00:00+05:30`).toISOString();
    const toDate = new Date(year, mon, 1); // first day of NEXT month (UTC)
    const to   = new Date(`${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-01T00:00:00+05:30`).toISOString();

    // Fetch only 'sale' type rows (net — returns are separate GSTR-1 amendment)
    let q = this.db.client
      .from('gst_ledger')
      .select('hsn_code, description, gst_rate, taxable_value, cgst, sgst, igst, quantity')
      .eq('txn_type', 'sale')
      .gte('txn_date', from)
      .lt('txn_date', to);
    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];

    // Aggregate by HSN + GST rate
    const map = new Map<string, {
      hsn: string; desc: string; rate: number;
      qty: number; taxable: number; igst: number; cgst: number; sgst: number;
    }>();
    for (const r of rows) {
      const key = `${r.hsn_code || 'UNKNOWN'}|${r.gst_rate || 0}`;
      const existing = map.get(key);
      if (existing) {
        existing.qty     += Number(r.quantity)       || 0;
        existing.taxable += Number(r.taxable_value)  || 0;
        existing.igst    += Number(r.igst)            || 0;
        existing.cgst    += Number(r.cgst)            || 0;
        existing.sgst    += Number(r.sgst)            || 0;
      } else {
        map.set(key, {
          hsn:     r.hsn_code    || 'UNKNOWN',
          desc:    r.description || '',
          rate:    Number(r.gst_rate)    || 0,
          qty:     Number(r.quantity)    || 0,
          taxable: Number(r.taxable_value) || 0,
          igst:    Number(r.igst)          || 0,
          cgst:    Number(r.cgst)          || 0,
          sgst:    Number(r.sgst)          || 0,
        });
      }
    }

    const sortedRows = [...map.values()].sort((a, b) => a.hsn.localeCompare(b.hsn));
    const header = [
      'Period', 'HSN Code', 'Description', 'UOM', 'Total Qty',
      'GST Rate %', 'Taxable Value (₹)', 'Integrated Tax (₹)',
      'Central Tax (₹)', 'State/UT Tax (₹)', 'Cess (₹)',
    ];
    const lines = sortedRows.map(r => [
      month,
      r.hsn,
      r.desc,
      'NOS',          // Unit of Measure — garments are "Numbers"
      r.qty,
      r.rate,
      this.rupees(r.taxable),
      this.rupees(r.igst),
      this.rupees(r.cgst),
      this.rupees(r.sgst),
      '0.00',         // No cess on garments
    ]);

    // Grand total row
    const tot = sortedRows.reduce(
      (s, r) => ({
        qty: s.qty + r.qty,
        taxable: s.taxable + r.taxable,
        igst: s.igst + r.igst,
        cgst: s.cgst + r.cgst,
        sgst: s.sgst + r.sgst,
      }),
      { qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 },
    );
    lines.push([month, 'TOTAL', '', 'NOS', tot.qty, '',
      this.rupees(tot.taxable), this.rupees(tot.igst), this.rupees(tot.cgst), this.rupees(tot.sgst), '0.00']);

    return this.toCsv([header, ...lines]);
  }

  // ── small utils ──
  private rupees(paise: any): string {
    return ((Number(paise) || 0) / 100).toFixed(2);
  }
  private csvDate(d: string): string {
    return new Date(d).toLocaleDateString('en-IN');
  }
  private dayStart(d: string): string {
    // Parse as IST midnight (UTC+05:30) so date-range queries match Indian calendar days.
    // e.g. '2026-05-01' → 2026-04-30T18:30:00.000Z (= 2026-05-01 00:00 IST)
    return new Date(`${d}T00:00:00+05:30`).toISOString();
  }
  private dayEnd(d: string): string {
    // Exclusive upper bound = start of NEXT day IST
    const x = new Date(`${d}T00:00:00+05:30`);
    x.setUTCDate(x.getUTCDate() + 1); // adds exactly 86 400 000 ms
    return x.toISOString();
  }
  private toCsv(rows: (string | number)[][]): string {
    const esc = (v: string | number) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"`  : s;
    };
    return rows.map((r) => r.map(esc).join(',')).join('\r\n');
  }
}
