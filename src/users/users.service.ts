import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { sanitisePermissions } from '../common/auth/permissions';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private db: DatabaseService,
    private email: EmailService,
  ) {}

  async findOne(id: string) {
    const { data } = await this.db.client
      .from('users')
      .select('id, name, email, phone, role, permissions, created_at')
      .eq('id', id)
      .single();
    if (!data) throw new NotFoundException('User not found');
    return data;
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    const { data, error } = await this.db.client
      .from('users')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, name, email, phone, role')
      .single();
    if (error) throw error;
    return data;
  }

  async findAll(page = 1, limit = 20) {
    const from = (page - 1) * limit;
    const { data, count } = await this.db.client
      .from('users')
      .select('id, name, email, phone, role, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);
    return { data, meta: { total: count, page, limit } };
  }

  /** Full profile + order history for one customer (admin). */
  async getDetail(id: string) {
    const { data: user } = await this.db.client
      .from('users')
      .select('id, name, email, phone, role, created_at')
      .eq('id', id)
      .single();
    if (!user) throw new NotFoundException('User not found');

    const { data: orders } = await this.db.client
      .from('orders')
      .select('id, order_number, status, payment_status, total, created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false });

    const paid = (orders || []).filter((o: any) => o.payment_status === 'paid');
    const stats = {
      total_orders: (orders || []).length,
      total_spent: paid.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0),
      last_order_at: orders && orders.length ? orders[0].created_at : null,
    };
    return { user, orders: orders || [], stats };
  }

  /**
   * One-click export of ALL customer data as CSV (admin). Includes per-user
   * order count, total spent (paid, paise) and last order date. All money in
   * paise; the CSV shows rupees. Use for backups / GDPR-style data requests.
   */
  async exportAllCsv(): Promise<string> {
    const { data: users } = await this.db.client
      .from('users')
      .select('id, name, email, phone, role, created_at')
      .order('created_at', { ascending: false });

    const { data: orders } = await this.db.client
      .from('orders')
      .select('user_id, total, payment_status, created_at');

    // Aggregate order stats per user in one pass.
    const stats = new Map<string, { count: number; spent: number; last: string | null }>();
    for (const o of orders || []) {
      if (!o.user_id) continue;
      const s = stats.get(o.user_id) || { count: 0, spent: 0, last: null };
      s.count += 1;
      if (o.payment_status === 'paid') s.spent += Number(o.total) || 0;
      if (!s.last || new Date(o.created_at) > new Date(s.last)) s.last = o.created_at;
      stats.set(o.user_id, s);
    }

    const rupees = (p: number) => (p / 100).toFixed(2);
    const header = ['Name', 'Email', 'Phone', 'Role', 'Joined', 'Total Orders', 'Total Spent (INR)', 'Last Order'];
    const rows = (users || []).map((u: any) => {
      const s = stats.get(u.id) || { count: 0, spent: 0, last: null };
      return [
        u.name || '',
        u.email || '',
        u.phone || '',
        u.role || 'customer',
        u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN') : '',
        s.count,
        rupees(s.spent),
        s.last ? new Date(s.last).toLocaleDateString('en-IN') : '',
      ];
    });

    const esc = (v: string | number) => {
      const str = String(v ?? '');
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    return [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  }

  // ── Admin user management ──────────────────────────────────────────────────

  /** Admin: edit any user's profile or role. */
  async adminUpdate(id: string, dto: { name?: string; email?: string; phone?: string; role?: string }) {
    const { data, error } = await this.db.client
      .from('users')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, name, email, phone, role, created_at')
      .single();
    if (error || !data) throw new NotFoundException('User not found');
    return data;
  }

  /** Admin: create a new user record (e.g. add another admin account). */
  async adminCreate(dto: { name?: string; email?: string; phone?: string; role?: string }) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Email or phone is required');
    }
    const { data, error } = await this.db.client
      .from('users')
      .insert({
        name: dto.name || null,
        email: dto.email || null,
        phone: dto.phone || null,
        role: dto.role || 'customer',
      })
      .select('id, name, email, phone, role, created_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * Admin: permanently delete a user. Blocked if the user has any orders
   * (preserve financial records). Soft-block (role='banned') is safer for
   * customers who have purchased.
   */
  async deleteUser(id: string) {
    // Prevent deletion if the user has orders
    const { count } = await this.db.client
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', id);
    if (count && count > 0) {
      throw new BadRequestException('Cannot delete a customer with order history. Change their role to "banned" instead.');
    }
    const { error } = await this.db.client.from('users').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message || 'Delete failed');
    return { message: 'User deleted' };
  }

  /** Admin: search users by name/email/phone. */
  async search(q: string, limit = 20) {
    // Escape double quotes so the quoted value is safe inside PostgREST .or().
    // Quoting the value (rather than stripping chars) preserves dots in emails.
    const escaped = q.replace(/"/g, '""');
    const pattern = `%${escaped}%`;
    const v = `"${pattern}"`; // PostgREST quoted value

    const { data } = await this.db.client
      .from('users')
      .select('id, name, email, phone, role, created_at')
      .or(`name.ilike.${v},email.ilike.${v},phone.ilike.${v}`)
      .order('created_at', { ascending: false })
      .limit(limit);
    return data || [];
  }

  // ── Staff & access management (RBAC, owner/admin only) ──────────────────────

  /** List all admin + staff accounts with their granted permissions. */
  async listStaff() {
    const { data } = await this.db.client
      .from('users')
      .select('id, name, email, phone, role, permissions, created_at')
      .in('role', ['admin', 'staff'])
      .order('created_at', { ascending: false });
    return (data || []).map((u: any) => ({
      ...u,
      permissions: Array.isArray(u.permissions) ? u.permissions : [],
    }));
  }

  /**
   * Create (or promote) a staff member with a limited set of permissions.
   * Login is OTP-based, so the staff member signs in with the email/phone set
   * here. If a user row already exists for that email/phone it is promoted to
   * `staff` (an existing customer can be made staff); otherwise a new row is
   * created.
   */
  async createStaff(dto: { name?: string; email?: string; phone?: string; permissions?: unknown }) {
    const email = dto.email?.trim() || null;
    const phone = dto.phone?.trim() || null;
    if (!email && !phone) {
      throw new BadRequestException('Email or phone is required to create a staff login');
    }
    const permissions = sanitisePermissions(dto.permissions);

    // Look for an existing user by email or phone (PostgREST-safe explicit lookup).
    const baseQuery = this.db.client.from('users').select('id, role');
    const { data: existing } = await (email
      ? baseQuery.eq('email', email)
      : baseQuery.eq('phone', phone!)
    ).maybeSingle();

    if (existing) {
      if (existing.role === 'admin') {
        throw new BadRequestException('This account is already a full admin and cannot be downgraded to staff here.');
      }
      const { data, error } = await this.db.client
        .from('users')
        .update({
          role: 'staff',
          permissions,
          ...(dto.name?.trim() ? { name: dto.name.trim() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('id, name, email, phone, role, permissions, created_at')
        .single();
      if (error) throw new BadRequestException(error.message);
      // Notify the existing user that they have been promoted to staff.
      if (data?.email) {
        this.email.sendStaffInvite(data.email, {
          staff_name: data.name || data.email,
          granted_by: 'Admin',
          permissions: Array.isArray(permissions) ? permissions : [],
        }).catch((e: any) => this.logger.warn(`Staff invite email failed for ${data.email}: ${e?.message}`));
      }
      return data;
    }

    const { data, error } = await this.db.client
      .from('users')
      .insert({
        name: dto.name?.trim() || null,
        email,
        phone,
        role: 'staff',
        permissions,
      })
      .select('id, name, email, phone, role, permissions, created_at')
      .single();
    if (error) throw new BadRequestException(error.message);
    // Notify the new staff member so they know they have access and how to sign in.
    if (data?.email) {
      this.email.sendStaffInvite(data.email, {
        staff_name: data.name || data.email,
        granted_by: 'Admin',
        permissions: Array.isArray(permissions) ? permissions : [],
      }).catch((e: any) => this.logger.warn(`Staff invite email failed for ${data.email}: ${e?.message}`));
    }
    return data;
  }

  /** Update a staff member's name and/or granted permissions. */
  async updateStaff(id: string, dto: { name?: string; permissions?: unknown }) {
    const { data: target } = await this.db.client
      .from('users')
      .select('id, role')
      .eq('id', id)
      .maybeSingle();
    if (!target) throw new NotFoundException('Staff member not found');
    if (target.role !== 'staff') {
      throw new BadRequestException('This account is not a staff member.');
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates.name = dto.name?.trim() || null;
    if (dto.permissions !== undefined) updates.permissions = sanitisePermissions(dto.permissions);

    const { data, error } = await this.db.client
      .from('users')
      .update(updates)
      .eq('id', id)
      .select('id, name, email, phone, role, permissions, created_at')
      .single();
    if (error || !data) throw new NotFoundException('Staff member not found');
    return data;
  }

  /**
   * Revoke a staff member's admin access: reset to a normal customer with no
   * permissions, and bump token_version so any active admin session is killed
   * immediately (rather than waiting for the 5-minute permission cache).
   */
  async revokeStaff(id: string) {
    const { data: target } = await this.db.client
      .from('users')
      .select('id, role, token_version')
      .eq('id', id)
      .maybeSingle();
    if (!target) throw new NotFoundException('Staff member not found');
    if (target.role !== 'staff') {
      throw new BadRequestException('This account is not a staff member.');
    }

    const { error } = await this.db.client
      .from('users')
      .update({
        role: 'customer',
        permissions: [],
        token_version: (target.token_version ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);
    return { message: 'Staff access revoked' };
  }
}
