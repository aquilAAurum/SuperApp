const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** PocketBase-format record id (15 chars, a-z0-9), generated on device so retries never duplicate. */
export function newRecordId(rand: (buf: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  let out = '';
  while (out.length < 15) {
    // Rejection sampling: 252 = 7 * 36, so bytes below it map uniformly onto the alphabet.
    for (const b of rand(new Uint8Array(32))) {
      if (b < 252 && out.length < 15) out += ALPHABET[b % 36];
    }
  }
  return out;
}

/** 256-bit random token, hex. Session tokens live only in memory (spec §Handshake step 6). */
export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison for tokens. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
