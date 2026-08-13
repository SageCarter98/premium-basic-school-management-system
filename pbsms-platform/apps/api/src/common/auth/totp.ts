/**
 * totp.ts — RFC 6238 TOTP (SEC-030: MFA). Implemented by hand on Node's
 * built-in `crypto` (HMAC-SHA1, RFC 4226's HOTP underneath TOTP) rather
 * than pulling in a package — this is the entire algorithm, not a subset,
 * so there's nothing a library would add here except a dependency.
 *
 * 30-second step, 6 digits, ±1 step tolerance for clock drift — all
 * standard defaults matching what every authenticator app (Google
 * Authenticator, Authy, etc.) assumes without being told otherwise.
 */

import { createHmac, randomBytes } from 'node:crypto';

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A fresh 20-byte secret, base32-encoded — the size every authenticator
 * app expects for a SHA1 TOTP secret. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** Verifies a 6-digit code against the current time step, allowing ±1 step
 * (±30s) either side for clock drift between the server and the user's
 * device — the same tolerance every real TOTP implementation uses. */
export function verifyTotp(base32Secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(base32Secret);
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (const drift of [0, -1, 1]) {
    if (hotp(secret, counter + drift) === code) return true;
  }
  return false;
}

/** otpauth:// URI for QR-code enrollment in an authenticator app. No QR
 * image is rendered here (no object storage exists in this scaffold,
 * same deferral as documents.service.ts's report cards) — the URI/secret
 * is returned as text; a real client renders its own QR code from it. */
export function otpauthUri(secret: string, email: string): string {
  const label = encodeURIComponent(`PBSMS:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=PBSMS&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
