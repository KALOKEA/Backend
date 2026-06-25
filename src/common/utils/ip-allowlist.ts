/**
 * Shared IP-allowlist matching used by the admin guards.
 *
 * Supports exact IPs (IPv4 + IPv6) and IPv4 CIDR ranges (e.g. 203.0.113.0/24).
 * Extracted so AdminGuard and PermissionsGuard apply identical network rules.
 */

/** Parse the ADMIN_IP_ALLOWLIST env value into a clean list of entries. */
export function parseAllowlist(raw: string | undefined | null): string[] {
  return (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Normalise an incoming client IP (strip IPv6-mapped IPv4 prefix). */
export function normaliseIp(clientIp: string): string {
  return (clientIp || '').replace(/^::ffff:/, '');
}

/** Convert a dotted IPv4 string to a 32-bit unsigned int, or null if invalid. */
function ipToLong(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) + o;
  }
  return n >>> 0;
}

/** True if clientIp matches an allowlist entry — exact match or IPv4 CIDR range. */
export function ipMatches(clientIp: string, entry: string): boolean {
  if (clientIp === entry) return true; // exact (also handles IPv6)
  if (!entry.includes('/')) return false;
  const [range, bitsStr] = entry.split('/');
  const bits = Number(bitsStr);
  const ipLong = ipToLong(clientIp);
  const rangeLong = ipToLong(range);
  if (ipLong === null || rangeLong === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipLong & mask) === (rangeLong & mask);
}

/** True if the client IP is allowed by ANY entry in the allowlist. */
export function isIpAllowed(clientIp: string, allowedIps: string[]): boolean {
  const normalised = normaliseIp(clientIp);
  return allowedIps.some((entry) => ipMatches(normalised, entry));
}
