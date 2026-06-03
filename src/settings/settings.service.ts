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
    };
  }

  async update(dto: UpdateSettingsDto): Promise<StoreSettings> {
    await this.db.client
      .from('store_settings')
      .upsert({ id: 1, ...dto, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    return this.get();
  }

  /**
   * GST collected for a month (default = current). Indian retail prices are
   * GST-inclusive, so tax is the portion inside the taxable value (subtotal less
   * discount). Intra-state (buyer state == seller state) splits CGST+SGST;
   * inter-state is IGST. Only counts paid orders. All amounts in paise.
   */
  async gstReport(month?: string) {
    const s = await this.get();
    const rate = Number(s.gst_rate) || 5;
    const sellerState = (s.seller_state || '').trim().toLowerCase();

    const now = new Date();
    const m = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const start = new Date(`${m}-01T00:00:00Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    const { data } = await this.db.client
      .from('orders')
      .select('subtotal, discount, total, address_snapshot, payment_status, created_at')
      .eq('payment_status', 'paid')
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString());

    let orders = 0, gross = 0, netValue = 0, totalGst = 0, cgst = 0, sgst = 0, igst = 0;
    for (const o of data || []) {
      orders++;
      gross += o.total || 0;
      const taxable = Math.max(0, (o.subtotal || 0) - (o.discount || 0));
      const net = Math.round(taxable / (1 + rate / 100));
      const tax = taxable - net;
      netValue += net;
      totalGst += tax;
      const buyerState = String(o.address_snapshot?.state || '').trim().toLowerCase();
      if (sellerState && sellerState === buyerState) {
        const half = Math.round(tax / 2);
        cgst += half;
        sgst += tax - half;
      } else {
        igst += tax;
      }
    }

    return { period: m, gst_rate: rate, orders, gross_sales: gross, net_value: netValue, total_gst: totalGst, cgst, sgst, igst };
  }
}
