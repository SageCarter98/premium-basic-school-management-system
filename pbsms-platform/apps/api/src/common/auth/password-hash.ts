import * as argon2 from 'argon2';

/**
 * OWASP-minimum argon2id profile (memoryCost 19 MiB, timeCost 2, parallelism 1)
 * — the library's own defaults (64 MiB, t=3, p=4) were measured at ~1.1s per
 * verify() in isolation and 3.5-13s under normal dev-machine load, which is
 * unacceptable login latency. This profile still meets OWASP's documented
 * minimum-safe argon2id guidance.
 */
export const PASSWORD_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};
