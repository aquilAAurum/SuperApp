/**
 * Server URL policy (spec §Security): HTTPS anywhere, or plain HTTP only to LAN / Tailscale /
 * loopback addresses. Pure and unit-tested (CORE-12).
 */
export type UrlResult = { ok: true; url: string } | { ok: false; error: string };

const PRIVATE_V4 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 (Tailscale CGNAT)
  /^127\./,
];

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.ts.net') || h.endsWith('.local')) return true;
  if (h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h)) return true; // loopback, ULA (incl. Tailscale fd7a:115c:a1e0::/48)
  return PRIVATE_V4.some((re) => re.test(h));
}

export function validateServerUrl(input: unknown): UrlResult {
  if (typeof input !== 'string' || input.trim() === '') return { ok: false, error: 'Server URL is required.' };
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, error: 'That is not a valid URL.' };
  }
  if (url.username || url.password) return { ok: false, error: 'Do not put credentials in the URL.' };
  if (url.search || url.hash) return { ok: false, error: 'Use the server address only, without ? or #.' };
  if (url.protocol === 'https:') return { ok: true, url: url.origin + url.pathname.replace(/\/+$/, '') };
  if (url.protocol === 'http:' && isPrivateHost(url.hostname)) return { ok: true, url: url.origin + url.pathname.replace(/\/+$/, '') };
  if (url.protocol === 'http:') return { ok: false, error: 'Plain HTTP is only allowed for LAN or Tailscale addresses. Use HTTPS.' };
  return { ok: false, error: 'Only https:// (or http:// on LAN/Tailscale) is allowed.' };
}
