import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';

const SR_BASE = 'https://apiv2.shiprocket.in/v1/external';

interface SrToken { token: string; expiresAt: number }

@Injectable()
export class ShiprocketService {
  private readonly logger = new Logger(ShiprocketService.name);
  private tokenCache: SrToken | null = null;

  constructor(
    private config: ConfigService,
    private db: DatabaseService,
    private email: EmailService,
  ) {}

  // ─── Auth ────────────────────────────────────────────────────────────────────

  /** Returns a valid JWT. Refreshes 5 min before expiry (token lasts 24 h). */
  private async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
      return this.tokenCache.token;
    }
    const email    = this.config.get<string>('SHIPROCKET_EMAIL');
    const password = this.config.get<string>('SHIPROCKET_PASSWORD');
    if (!email || !password) {
      throw new InternalServerErrorException('ShipRocket credentials not configured (SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD)');
    }
    const res = await fetch(`${SR_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`ShipRocket auth failed: ${body}`);
      throw new InternalServerErrorException('ShipRocket authentication failed');
    }
    const data = await res.json();
    this.tokenCache = {
      token: data.token,
      expiresAt: Date.now() + 23 * 60 * 60 * 1000, // treat as 23 h
    };
    return this.tokenCache.token;
  }

  /** Authenticated fetch to ShipRocket API. */
  private async srFetch(path: string, init: RequestInit = {}): Promise<any> {
    const token = await this.getToken();
    const res = await fetch(`${SR_BASE}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body?.message || body?.error || JSON.stringify(body);
      this.logger.error(`SR ${init.method || 'GET'} ${path} → ${res.status}: ${msg}`);
      throw new BadRequestException(`ShipRocket: ${msg}`);
    }
    return body;
  }

  // ─── Order helpers ───────────────────────────────────────────────────────────

  private async loadOrder(orderId: string) {
    const { data, error } = await this.db.client
      .from('orders')
      .select('*, order_items(*), users(name, email), addresses(*)')
      .eq('id', orderId)
      .single();
    if (error || !data) throw new BadRequestException('Order not found');
    return data;
  }

  // ─── Push order to ShipRocket + auto-assign AWB ──────────────────────────────

  async pushOrder(orderId: string, opts: { weight?: number; length?: number; breadth?: number; height?: number; courier_id?: number } = {}) {
    const order = await this.loadOrder(orderId);

    if (order.shiprocket_order_id) {
      throw new BadRequestException('Order already pushed to ShipRocket (shiprocket_order_id exists)');
    }

    const addr = order.address_snapshot || {};
    const items: any[] = order.order_items || [];

    // ShipRocket expects rupees, not paise
    const toRupees = (paise: number) => +(paise / 100).toFixed(2);

    const srItems = items.map((i: any) => ({
      name:          i.snapshot_name || 'Product',
      sku:           i.snapshot_sku  || `SKU-${i.id?.slice(0, 8)}`,
      units:         i.quantity,
      selling_price: toRupees(i.snapshot_price),
      discount:      0,
      tax:           0,
      hsn:           i.snapshot_hsn_code || 0,
    }));

    const pickupLocation = this.config.get<string>('SHIPROCKET_PICKUP_LOCATION') || 'Primary';
    const orderDate = new Date(order.created_at).toISOString().replace('T', ' ').slice(0, 19);

    const payload = {
      order_id:                   order.order_number,
      order_date:                 orderDate,
      pickup_location:            pickupLocation,
      billing_customer_name:      addr.name || order.users?.name || 'Customer',
      billing_last_name:          '',
      billing_address:            addr.line1 || 'Address',
      billing_address_2:          addr.line2 || '',
      billing_city:               addr.city  || 'City',
      billing_pincode:            addr.pincode || '000000',
      billing_state:              addr.state || 'State',
      billing_country:            'India',
      billing_email:              order.users?.email || order.guest_email || '',
      billing_phone:              addr.phone || '9999999999',
      shipping_is_billing:        true,
      order_items:                srItems,
      payment_method:             order.payment_method === 'cod' ? 'COD' : 'Prepaid',
      shipping_charges:           0,
      giftwrap_charges:           0,
      transaction_charges:        0,
      total_discount:             toRupees(order.discount || 0),
      sub_total:                  toRupees(order.total),
      length:                     opts.length   ?? 20,
      breadth:                    opts.breadth  ?? 15,
      height:                     opts.height   ?? 5,
      weight:                     opts.weight   ?? 0.5,
    };

    // 1. Create order in ShipRocket
    const created = await this.srFetch('/orders/create/adhoc', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const srOrderId    = created.order_id;
    const srShipmentId = created.shipment_id;

    // 2. Auto-assign best courier (cheapest recommended)
    let awbData: any = {};
    try {
      const courierId = opts.courier_id
        ?? this.config.get<number>('SHIPROCKET_DEFAULT_COURIER_ID')
        ?? undefined;
      awbData = await this.srFetch('/courier/assign/awb', {
        method: 'POST',
        body: JSON.stringify({
          shipment_id: String(srShipmentId),
          ...(courierId ? { courier_id: String(courierId) } : {}),
        }),
      });
    } catch (e: any) {
      this.logger.warn(`AWB auto-assign failed, will retry manually: ${e.message}`);
    }

    const awbCode    = awbData?.response?.data?.awb_code || null;
    const courierId  = awbData?.response?.data?.courier_id || null;
    const courierNm  = awbData?.response?.data?.courier_name || null;

    // 3. Persist ShipRocket data on order
    await this.db.client
      .from('orders')
      .update({
        shiprocket_order_id:    srOrderId,
        shiprocket_shipment_id: srShipmentId,
        awb_code:               awbCode,
        courier_id:             courierId,
        courier_name:           courierNm,
        shiprocket_status:      'created',
        fulfillment_status:     'processing',
        ...(awbCode ? { status: 'confirmed' } : {}),
      })
      .eq('id', orderId);

    return {
      shiprocket_order_id:    srOrderId,
      shiprocket_shipment_id: srShipmentId,
      awb_code:               awbCode,
      courier_name:           courierNm,
    };
  }

  // ─── Assign / reassign AWB manually ─────────────────────────────────────────

  async assignAwb(orderId: string, courierId?: number) {
    const order = await this.loadOrder(orderId);
    if (!order.shiprocket_shipment_id) throw new BadRequestException('Push order to ShipRocket first');

    const awbData = await this.srFetch('/courier/assign/awb', {
      method: 'POST',
      body: JSON.stringify({
        shipment_id: String(order.shiprocket_shipment_id),
        ...(courierId ? { courier_id: String(courierId) } : {}),
      }),
    });

    const awbCode   = awbData?.response?.data?.awb_code;
    const cId       = awbData?.response?.data?.courier_id;
    const courierNm = awbData?.response?.data?.courier_name;

    await this.db.client
      .from('orders')
      .update({ awb_code: awbCode, courier_id: cId, courier_name: courierNm, shiprocket_status: 'awb_assigned' })
      .eq('id', orderId);

    // Auto-email customer when AWB is assigned
    if (awbCode) {
      const customerEmail = order.guest_email || order.users?.email;
      const customerName  = order.users?.name || 'Customer';
      if (customerEmail) {
        this.email.sendOrderAwbAssigned(customerEmail, {
          customer_name: customerName,
          order_id:      order.order_number,
          awb_code:      awbCode,
          courier_name:  courierNm || 'Courier',
        }).catch(() => {});
      }
    }

    return { awb_code: awbCode, courier_name: courierNm };
  }

  // ─── Generate shipping label ─────────────────────────────────────────────────

  async generateLabel(orderId: string) {
    const order = await this.loadOrder(orderId);
    if (!order.shiprocket_shipment_id) throw new BadRequestException('No ShipRocket shipment found');

    const data = await this.srFetch('/courier/generate/label', {
      method: 'POST',
      body: JSON.stringify({ shipment_id: [order.shiprocket_shipment_id] }),
    });

    const labelUrl = data?.label_url || data?.response?.label_url;
    if (labelUrl) {
      await this.db.client
        .from('orders')
        .update({ label_url: labelUrl })
        .eq('id', orderId);
    }
    return { label_url: labelUrl };
  }

  // ─── Schedule pickup ─────────────────────────────────────────────────────────

  async schedulePickup(orderId: string) {
    const order = await this.loadOrder(orderId);
    if (!order.shiprocket_shipment_id) throw new BadRequestException('No ShipRocket shipment found');

    const data = await this.srFetch('/courier/generate/pickup', {
      method: 'POST',
      body: JSON.stringify({ shipment_id: [order.shiprocket_shipment_id] }),
    });

    await this.db.client
      .from('orders')
      .update({ pickup_scheduled_at: new Date().toISOString(), shiprocket_status: 'pickup_scheduled' })
      .eq('id', orderId);

    return data;
  }

  // ─── Track shipment ──────────────────────────────────────────────────────────

  async trackShipment(orderId: string) {
    const order = await this.loadOrder(orderId);
    if (!order.awb_code && !order.shiprocket_shipment_id) {
      throw new BadRequestException('No AWB or shipment ID to track');
    }

    if (order.awb_code) {
      const data = await this.srFetch(`/courier/track/awb/${order.awb_code}`);
      return data;
    }
    return this.srFetch(`/courier/track/shipment/${order.shiprocket_shipment_id}`);
  }

  /** Track by AWB directly (for customer-facing use — no auth needed on our side). */
  async trackByAwb(awb: string) {
    return this.srFetch(`/courier/track/awb/${awb}`);
  }

  // ─── Cancel shipment in ShipRocket ──────────────────────────────────────────

  async cancelShipment(orderId: string) {
    const order = await this.loadOrder(orderId);
    if (!order.shiprocket_order_id) throw new BadRequestException('Order not in ShipRocket');

    const data = await this.srFetch('/orders/cancel', {
      method: 'POST',
      body: JSON.stringify({ ids: [order.shiprocket_order_id] }),
    });

    await this.db.client
      .from('orders')
      .update({ shiprocket_status: 'cancelled' })
      .eq('id', orderId);

    return data;
  }

  // ─── Courier serviceability check ────────────────────────────────────────────

  async getServiceability(deliveryPincode: string, weight = 0.5, cod = false) {
    const pickupPincode = this.config.get<string>('SHIPROCKET_PICKUP_PINCODE') || '110001';
    return this.srFetch(
      `/courier/serviceability?pickup_postcode=${pickupPincode}&delivery_postcode=${deliveryPincode}&cod=${cod ? 1 : 0}&weight=${weight}`
    );
  }

  // ─── Webhook handler ─────────────────────────────────────────────────────────

  async handleWebhook(payload: any): Promise<void> {
    const awb    = payload?.awb || payload?.AWB;
    const status = payload?.current_status;
    if (!awb || !status) return;

    // Map ShipRocket status to our order status
    const statusMap: Record<string, string> = {
      'Shipped':           'shipped',
      'Out For Delivery':  'shipped',
      'Delivered':         'delivered',
      'Undelivered':       'shipped',
      'Cancelled':         'cancelled',
      'RTO Initiated':     'shipped',
      'RTO Delivered':     'cancelled',
      'Lost':              'cancelled',
    };
    const ourStatus = statusMap[status];

    const { data: order } = await this.db.client
      .from('orders')
      .select('id, status')
      .eq('awb_code', awb)
      .single();

    if (!order) {
      this.logger.warn(`Webhook: no order found for AWB ${awb}`);
      return;
    }

    const updates: any = { shiprocket_status: status };
    if (ourStatus && order.status !== ourStatus) {
      updates.status = ourStatus;
      if (ourStatus === 'shipped') updates.fulfillment_status = 'shipped';
      if (ourStatus === 'delivered') updates.fulfillment_status = 'delivered';
    }

    await this.db.client.from('orders').update(updates).eq('id', order.id);
    this.logger.log(`Webhook: order ${order.id} status="${status}" (our: ${ourStatus || 'no change'})`);
  }

  // ─── Manifest generation ─────────────────────────────────────────────────────

  async generateManifest(shipmentIds: number[]) {
    if (!shipmentIds?.length) throw new BadRequestException('Provide at least one shipment_id');
    const data = await this.srFetch('/manifests/generate', {
      method: 'POST',
      body: JSON.stringify({ shipment_id: shipmentIds }),
    });
    return { manifest_url: data?.manifest_url || data?.response?.manifest_url || null, raw: data };
  }

  // ─── Bulk tracking sync ──────────────────────────────────────────────────────

  async syncTrackingAll(): Promise<{ updated: number }> {
    const terminalStatuses = ['Delivered', 'Cancelled', 'RTO Delivered', 'Lost'];
    const { data: orders } = await this.db.client
      .from('orders')
      .select('id, awb_code, shiprocket_status, status')
      .not('awb_code', 'is', null)
      .not('shiprocket_status', 'in', `(${terminalStatuses.map(s => `"${s}"`).join(',')})`);

    if (!orders?.length) return { updated: 0 };

    // Mirror the status map used in handleWebhook so bulk sync stays consistent.
    const statusMap: Record<string, string> = {
      'Shipped':          'shipped',
      'Out For Delivery': 'shipped',
      'Delivered':        'delivered',
      'Undelivered':      'shipped',
      'Cancelled':        'cancelled',
      'RTO Initiated':    'shipped',
      'RTO Delivered':    'cancelled',
      'Lost':             'cancelled',
    };

    let updated = 0;
    for (const order of orders) {
      try {
        const track = await this.srFetch(`/courier/track/awb/${order.awb_code}`);
        const status = track?.tracking_data?.shipment_track?.[0]?.current_status
                    || track?.tracking_data?.current_status;
        if (status && status !== order.shiprocket_status) {
          const ourStatus = statusMap[status];
          const updates: any = { shiprocket_status: status, tracking_synced_at: new Date().toISOString() };
          // Also advance orders.status / fulfillment_status so the admin order
          // list reflects actual delivery state (previously only shiprocket_status
          // was written, leaving orders stuck as 'shipped' after delivery).
          if (ourStatus && order.status !== ourStatus) {
            updates.status = ourStatus;
            if (ourStatus === 'shipped')   updates.fulfillment_status = 'shipped';
            if (ourStatus === 'delivered') updates.fulfillment_status = 'delivered';
          }
          await this.db.client
            .from('orders')
            .update(updates)
            .eq('id', order.id);
          updated++;
        }
      } catch (e: any) {
        this.logger.warn(`syncTrackingAll: failed for AWB ${order.awb_code}: ${e.message}`);
      }
    }
    return { updated };
  }

  // ─── NDR list ────────────────────────────────────────────────────────────────

  async getNdrs() {
    return this.srFetch('/ndr/list');
  }

  // ─── NDR action ──────────────────────────────────────────────────────────────

  async ndrAction(shipmentId: string, action: 'reAttempt' | 'return', comment = '') {
    const data = await this.srFetch(`/ndr/${shipmentId}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, comment }),
    });
    await this.db.client
      .from('orders')
      .update({ ndr_action: action })
      .eq('shiprocket_shipment_id', Number(shipmentId));
    return data;
  }

  // ─── Return / reverse pickup ─────────────────────────────────────────────────

  async createReturnPickup(orderId: string) {
    const order = await this.loadOrder(orderId);
    if (!order.awb_code) throw new BadRequestException('Order has no AWB — push and assign AWB first');

    const addr  = order.address_snapshot || {};
    const items: any[] = order.order_items || [];
    const toRupees = (p: number) => +(p / 100).toFixed(2);

    const payload = {
      order_id:              `RET-${order.order_number}`,
      order_date:            new Date().toISOString().replace('T', ' ').slice(0, 19),
      channel_id:            '',
      pickup_customer_name:  addr.name || order.users?.name || 'Customer',
      pickup_last_name:      '',
      pickup_address:        addr.line1 || '',
      pickup_address_2:      addr.line2 || '',
      pickup_city:           addr.city  || '',
      pickup_state:          addr.state || '',
      pickup_country:        'India',
      pickup_pincode:        addr.pincode || '',
      pickup_email:          order.users?.email || order.guest_email || '',
      pickup_phone:          addr.phone || '',
      pickup_isd_code:       '91',
      shipping_customer_name: this.config.get('SHIPROCKET_PICKUP_LOCATION') || 'Kalokea',
      shipping_last_name:    '',
      shipping_address:      this.config.get('SHIPROCKET_PICKUP_ADDRESS') || '',
      shipping_address_2:    '',
      shipping_city:         this.config.get('SHIPROCKET_PICKUP_CITY') || '',
      shipping_country:      'India',
      shipping_pincode:      this.config.get('SHIPROCKET_PICKUP_PINCODE') || '',
      shipping_state:        this.config.get('SHIPROCKET_PICKUP_STATE') || '',
      shipping_email:        this.config.get('ADMIN_EMAIL') || '',
      shipping_phone:        this.config.get('SHIPROCKET_PICKUP_PHONE') || '',
      order_items: items.map((i: any) => ({
        name:          i.snapshot_name || 'Product',
        sku:           i.snapshot_sku  || `SKU-${i.id?.slice(0, 8)}`,
        units:         i.quantity,
        selling_price: toRupees(i.snapshot_price),
      })),
      payment_method: 'Prepaid',
      sub_total:      toRupees(order.total),
      length: 20, breadth: 15, height: 5, weight: 0.5,
    };

    return this.srFetch('/orders/return', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // ─── COD remittance ──────────────────────────────────────────────────────────

  async getCodRemittance() {
    return this.srFetch('/account/details/cod-remittance');
  }

  // ─── Packaging profiles (local DB) ───────────────────────────────────────────

  async getPackagingProfiles() {
    const { data } = await this.db.client
      .from('packaging_profiles')
      .select('*')
      .order('is_default', { ascending: false });
    return data || [];
  }

  async createPackagingProfile(dto: {
    name: string; weight: number; length: number;
    breadth: number; height: number; is_default?: boolean;
  }) {
    if (dto.is_default) {
      await this.db.client.from('packaging_profiles').update({ is_default: false }).eq('is_default', true);
    }
    const { data, error } = await this.db.client
      .from('packaging_profiles')
      .insert({ ...dto, is_default: dto.is_default ?? false })
      .select()
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deletePackagingProfile(id: string) {
    await this.db.client.from('packaging_profiles').delete().eq('id', id);
    return { message: 'Deleted' };
  }

  async setDefaultPackagingProfile(id: string) {
    await this.db.client.from('packaging_profiles').update({ is_default: false }).neq('id', id);
    await this.db.client.from('packaging_profiles').update({ is_default: true }).eq('id', id);
    return { message: 'Default updated' };
  }
}
