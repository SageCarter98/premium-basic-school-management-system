import { Matches, ValidationOptions } from 'class-validator';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * is-uuid-like.ts
 *
 * class-validator's built-in @IsUUID() enforces RFC4122 version/variant
 * nibbles (versions 1-5 only) — but this scaffold's own seed data
 * (infra/seed/seed_demo.sql) deliberately uses human-readable fake ids like
 * 'aaaaaaaa-0000-0000-0000-000000000001' for manual testing, which have a
 * '0' version nibble and fail that check. Caught live: every create/convert
 * endpoint rejected the seed data's own ids as "must be a UUID." Real ids
 * from gen_random_uuid() are always valid v4 and still pass this — this
 * only relaxes the version/variant check, not the shape.
 *
 * Accepts optional ValidationOptions (e.g. `{ each: true }` for a
 * `string[]` field) — every pre-existing call site passes none, so this
 * stays backward compatible.
 */
export function IsUuidLike(options?: ValidationOptions) {
  return Matches(UUID_SHAPE, { message: '$property must be a UUID-shaped string', ...options });
}
