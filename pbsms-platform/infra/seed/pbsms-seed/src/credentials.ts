import { createHash, scryptSync } from 'node:crypto';

/**
 * FIXTURE PASSWORD HASHING — NOT PRODUCTION CODE.
 *
 * Two things here are deliberately unsafe and would be serious defects in a
 * real auth service:
 *
 *   1. Salts are DERIVED from the password, not random. That is what makes the
 *      fixture reproducible: a random salt per user would change the hash on
 *      every run and break the determinism guarantee the whole package rests
 *      on. It also means identical passwords produce identical hashes, which is
 *      exactly what salting exists to prevent.
 *   2. The passwords are published in CREDENTIALS.md.
 *
 * Both are fine for a database nobody outside the team can reach and fatal for
 * one anybody can. The guard is operational, not technical: never point this
 * generator at an environment that holds real people's data. If you need a
 * production-shaped hash, set --hash none, emit the plaintext, and let your own
 * auth service hash it on load through whatever argon2id parameters you have
 * settled on.
 *
 * scrypt is used because it ships in Node core. It is a legitimate password
 * KDF, but it is almost certainly not the one the application uses, so the
 * algorithm is recorded per row in password_algo rather than assumed.
 */

export type HashMode = 'scrypt' | 'none';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

// Memoised. The fixture uses a handful of shared passwords across thousands of
// users; hashing each one separately would take minutes at the volume profile
// and add nothing, since the hashes would be identical anyway.
const cache = new Map<string, string>();

function deterministicSalt(password: string, seed: string): Buffer {
  return createHash('sha256').update(`${seed}::salt::${password}`).digest().subarray(0, 16);
}

export function hashPassword(password: string, mode: HashMode, seed: string): { algo: string; hash: string } {
  if (mode === 'none') {
    return { algo: 'plaintext', hash: `plain:${password}` };
  }
  const key = `${seed}|${password}`;
  let hash = cache.get(key);
  if (!hash) {
    const salt = deterministicSalt(password, seed);
    const derived = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
    hash = `scrypt$N=${N},r=${R},p=${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
    cache.set(key, hash);
  }
  return { algo: 'scrypt', hash };
}

export function resetHashCache(): void {
  cache.clear();
}

/** Deterministic opaque token for invitations, resets and access links. */
export function token(seed: string, kind: string, discriminator: string): string {
  return createHash('sha256').update(`${seed}::${kind}::${discriminator}`).digest('base64url').slice(0, 43);
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Deterministic base32 TOTP secret, so a test can compute a valid code. */
export function totpSecret(seed: string, userId: string): string {
  const bytes = createHash('sha256').update(`${seed}::totp::${userId}`).digest().subarray(0, 20);
  let out = '';
  for (const b of bytes) out += BASE32[b % 32];
  return out;
}
