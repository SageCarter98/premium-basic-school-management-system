/**
 * Deterministic RNG. Math.random() is banned in this package — a seed run that
 * is not byte-reproducible cannot be used as a CI fixture, because a failing
 * test could not be replayed.
 *
 * Named sub-streams matter: rng.stream('finance') gives finance its own
 * sequence, so adding a student later does not shift every invoice number in
 * the diff. Without this, any change to one generator reshuffles all the others
 * and the fixture diff becomes unreadable.
 */

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next: () => number;
  private readonly rootSeed: string;
  private readonly streams = new Map<string, Rng>();

  constructor(seed: string) {
    this.rootSeed = seed;
    this.next = mulberry32(xmur3(seed)());
  }

  /** A stable, independent sub-stream. Re-requesting the same name returns the same stream. */
  stream(name: string): Rng {
    let s = this.streams.get(name);
    if (!s) {
      s = new Rng(`${this.rootSeed}::${name}`);
      this.streams.set(name, s);
    }
    return s;
  }

  float(): number {
    return this.next();
  }

  /** Inclusive of min, exclusive of max. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min));
  }

  bool(pTrue = 0.5): boolean {
    return this.next() < pTrue;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick called on an empty array');
    return items[Math.floor(this.next() * items.length)];
  }

  /** Weighted pick. weights must be same length as items and sum > 0. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Fisher-Yates on a copy. Does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  sample<T>(items: readonly T[], n: number): T[] {
    return this.shuffle(items).slice(0, Math.min(n, items.length));
  }

  /** Box-Muller, clamped. Used for score distributions that should not be uniform. */
  normal(mean: number, stdDev: number, min: number, max: number): number {
    const u1 = Math.max(this.next(), 1e-9);
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.min(max, Math.max(min, mean + z * stdDev));
  }
}

/* ------------------------------------------------------------- id helpers */

const counters = new Map<string, number>();

/** Deterministic sequential id. Reset per run via resetIds(). */
export function nextId(prefix: string, scope = ''): string {
  const key = `${prefix}:${scope}`;
  const n = (counters.get(key) ?? 0) + 1;
  counters.set(key, n);
  return scope
    ? `${prefix}_${scope}_${String(n).padStart(4, '0')}`
    : `${prefix}_${String(n).padStart(4, '0')}`;
}

export function resetIds(): void {
  counters.clear();
}

/* ----------------------------------------------------------- date helpers */

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** School days between two dates, inclusive, weekends excluded. */
export function schoolDays(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 400) {
    if (!isWeekend(cur)) out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function at(date: string, hour: number, minute: number): string {
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}
