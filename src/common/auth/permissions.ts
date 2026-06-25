/**
 * Admin-panel permission keys (RBAC).
 *
 * Each key corresponds to one section of the admin panel. A `staff` user may
 * only access the sections present in their `permissions` array. Full admins
 * (role = 'admin') bypass these checks entirely and have unrestricted access.
 *
 * IMPORTANT: keep this list in sync with the frontend's permission list
 * (FRONTEND/lib/permissions.ts) so the admin UI and the API agree.
 */
export const GRANTABLE_PERMISSIONS = [
  'orders', // view & manage orders, refunds
  'products', // products, variants, inventory
  'categories', // category management
  'coupons', // discount coupons
  'banners', // homepage banners
  'reviews', // moderate product reviews
  'returns', // manage return requests
  'exchanges', // manage exchange requests
  'shipments', // shiprocket shipments / tracking
  'customers', // view customer list & details (read-only)
  'newsletter', // newsletter subscribers & campaigns
  'cms', // CMS pages
  'content', // about / footer / static site content
  'homepage', // homepage content blocks
  'blog', // blog / journal posts
  'analytics', // analytics dashboards
] as const;

export type Permission = (typeof GRANTABLE_PERMISSIONS)[number];

const PERMISSION_SET = new Set<string>(GRANTABLE_PERMISSIONS);

/** True when `p` is a recognised, grantable permission key. */
export function isValidPermission(p: unknown): p is Permission {
  return typeof p === 'string' && PERMISSION_SET.has(p);
}

/**
 * Sanitise an arbitrary input into a clean, de-duplicated array of valid
 * permission keys. Anything unrecognised is dropped — never throws.
 */
export function sanitisePermissions(input: unknown): Permission[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<Permission>();
  for (const item of input) {
    if (isValidPermission(item)) out.add(item);
  }
  return [...out];
}
