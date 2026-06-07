import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

export interface StoreSettings {
  seller_name: string;
  seller_address: string;
  seller_gstin: string;
  seller_state: string;
  gst_rate: number;
  admin_email: string;
  shipping_fee: number;           // paise
  shipping_free_threshold: number; // paise
  cod_fee: number;                 // paise
  live_chat_widget: string;        // embed HTML/script for chat widget
  low_stock_threshold: number;     // alert when stock drops below this
  footer_instagram_url: string;
  footer_whatsapp_url: string;
}

const DEFAULTS: StoreSettings = {
  seller_name: 'KALOKEA',
  seller_address: '',
  seller_gstin: '',
  seller_state: '',
  gst_rate: 5,
  admin_email: '',
  shipping_fee: 4900,
  shipping_free_threshold: 99900,
  cod_fee: 4900,
  live_chat_widget: '',
  low_stock_threshold: 5,
  footer_instagram_url: 'https://www.instagram.com/kalokea.in',
  footer_whatsapp_url: 'https://wa.me/919999999999',
};

@Injectable()
export class SettingsService {
  constructor(private db: DatabaseService) {}

  /** Always returns a full settings object (DB row merged over defaults). */
  async get(): Promise<StoreSettings> {
    const { data } = await this.db.client
      .from('store_settings').select('*').eq('id', 1).maybeSingle();
    return {
      ...DEFAULTS,
      ...(data || {}),
      gst_rate: Number(data?.gst_rate ?? DEFAULTS.gst_rate),
      shipping_fee: Number(data?.shipping_fee ?? DEFAULTS.shipping_fee),
      shipping_free_threshold: Number(data?.shipping_free_threshold ?? DEFAULTS.shipping_free_threshold),
      cod_fee: Number(data?.cod_fee ?? DEFAULTS.cod_fee),
      low_stock_threshold: Number(data?.low_stock_threshold ?? DEFAULTS.low_stock_threshold),
    };
  }

  async update(dto: UpdateSettingsDto): Promise<StoreSettings> {
    await this.db.client
      .from('store_settings')
      .upsert({ id: 1, ...dto, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    return this.get();
  }

  /**
   * GST collected for a month — reads from gst_ledger (the authoritative,
   * immutable accounting record) so the numbers EXACTLY match what was charged
   * at checkout. The old approach re-computed from orders using the inclusive
   * model (÷1.05) which gave a different number than the exclusive model used at
   * checkout (×0.05). This fix ensures admin reports match GSTR-1 filings (NC-4).
   */
  async gstReport(month?: string) {
    const s = await this.get();
    const rate = Number(s.gst_rate) || 5;

    const now = new Date();
    const m = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const start = new Date(`${m}-01T00:00:00Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    // Read from the immutable ledger — only 'sale' rows (returns are negative entries).
    const { data } = await this.db.client
      .from('gst_ledger')
      .select('taxable_value, total_gst, cgst, sgst, igst, gross')
      .eq('txn_type', 'sale')
      .gte('txn_date', start.toISOString())
      .lt('txn_date', end.toISOString());

    let rows = 0, grossSales = 0, netValue = 0, totalGst = 0, cgst = 0, sgst = 0, igst = 0;
    for (const row of data || []) {
      rows++;
      grossSales += Number(row.gross) || 0;
      netValue   += Number(row.taxable_value) || 0;
      totalGst   += Number(row.total_gst) || 0;
      cgst       += Number(row.cgst) || 0;
      sgst       += Number(row.sgst) || 0;
      igst       += Number(row.igst) || 0;
    }

    return {
      period: m,
      gst_rate: rate,
      ledger_rows: rows,
      gross_sales: grossSales,
      net_value: netValue,
      total_gst: totalGst,
      cgst,
      sgst,
      igst,
    };
  }
}
