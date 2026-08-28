import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { TENANT_TABLE_ORDER, type SeedGraph, type TenantGraph } from '../types.js';

/**
 * Everything here is chunked.
 *
 * JSON.stringify on the whole volume-profile graph throws RangeError: Invalid
 * string length — V8 caps a single string around 512MB, and the graph is
 * bigger than that. Hashing and writing therefore walk the graph row by row and
 * never hold the serialised form in memory at once. The fingerprint is
 * identical to what a whole-graph hash would produce for small graphs only if
 * the traversal order is fixed, so the traversal order below is explicit and
 * must not be changed casually — doing so invalidates every recorded
 * fingerprint.
 */

function* graphChunks(graph: SeedGraph): Generator<string> {
  yield JSON.stringify(graph.meta);
  for (const row of graph.plans) yield JSON.stringify(row);
  for (const row of graph.tenants) yield JSON.stringify(row);
  for (const row of graph.platform_users) yield JSON.stringify(row);
  for (const row of graph.metering) yield JSON.stringify(row);
  for (const row of graph.platform_invoices) yield JSON.stringify(row);
  for (const row of graph.impersonation_grants) yield JSON.stringify(row);
  for (const g of graph.by_tenant) {
    yield JSON.stringify(g.tenant);
    for (const key of TENANT_TABLE_ORDER) {
      yield `#${key}`;
      for (const row of g[key] as unknown[]) yield JSON.stringify(row);
    }
  }
}

export function fingerprint(graph: SeedGraph): string {
  const h = createHash('sha256');
  for (const chunk of graphChunks(graph)) h.update(chunk);
  return h.digest('hex').slice(0, 16);
}

/** Only safe for ci/dev-sized graphs. Kept for tests and small inspection. */
export function toJson(graph: SeedGraph): string {
  return JSON.stringify(graph, null, 2);
}

async function writeStreamed(path: string, chunks: Iterable<string>): Promise<void> {
  const out = createWriteStream(path, { encoding: 'utf8' });
  for (const chunk of chunks) {
    if (!out.write(chunk)) {
      await new Promise<void>((resolve) => out.once('drain', () => resolve()));
    }
  }
  await new Promise<void>((resolve, reject) => {
    out.end(() => resolve());
    out.once('error', reject);
  });
}

function* tenantNdjson(g: TenantGraph): Generator<string> {
  yield `${JSON.stringify({ table: 'tenant', row: g.tenant })}\n`;
  for (const key of TENANT_TABLE_ORDER) {
    for (const row of g[key] as unknown[]) {
      yield `${JSON.stringify({ table: key, row })}\n`;
    }
  }
}

function* platformNdjson(graph: SeedGraph): Generator<string> {
  yield `${JSON.stringify({ table: 'meta', row: graph.meta })}\n`;
  for (const row of graph.plans) yield `${JSON.stringify({ table: 'plans', row })}\n`;
  for (const row of graph.tenants) yield `${JSON.stringify({ table: 'tenants', row })}\n`;
  for (const row of graph.platform_users) yield `${JSON.stringify({ table: 'platform_users', row })}\n`;
  for (const row of graph.metering) yield `${JSON.stringify({ table: 'metering', row })}\n`;
  for (const row of graph.platform_invoices) yield `${JSON.stringify({ table: 'platform_invoices', row })}\n`;
  for (const row of graph.impersonation_grants) yield `${JSON.stringify({ table: 'impersonation_grants', row })}\n`;
}

/**
 * NDJSON rather than one JSON document, because a test that wants only the
 * students of one tenant should not have to parse 400MB to get them, and
 * because a line-oriented file diffs legibly when the generator changes.
 */
export async function writeJson(graph: SeedGraph, dir: string): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];

  const platform = join(dir, 'platform.ndjson');
  await writeStreamed(platform, platformNdjson(graph));
  written.push(platform);

  for (const g of graph.by_tenant) {
    const p = join(dir, `tenant.${g.tenant.slug}.ndjson`);
    await writeStreamed(p, tenantNdjson(g));
    written.push(p);
  }

  const tables: Record<string, number> = {};
  for (const key of TENANT_TABLE_ORDER) {
    tables[key] = graph.by_tenant.reduce((n, g) => n + (g[key] as unknown[]).length, 0);
  }
  const mp = join(dir, 'manifest.json');
  writeFileSync(
    mp,
    JSON.stringify(
      {
        meta: graph.meta,
        tenants: graph.by_tenant.map((g) => ({ id: g.tenant.id, slug: g.tenant.slug, status: g.tenant.status })),
        tables,
      },
      null,
      2,
    ),
  );
  written.push(mp);

  return written;
}

export { writeStreamed };

/**
 * Service-layer adapter.
 *
 * Loading via SQL is fast and proves the RLS policies. Loading via the API
 * proves something different and equally worth knowing: that the validation
 * rules, the tenant-context middleware and the AsyncLocalStorage plumbing all
 * accept data the domain says is legal. Implement this against the NestJS
 * services and run the same graph through both paths — a row that SQL accepts
 * and the API rejects is a spec disagreement worth finding early.
 */
export interface SeedSink {
  /** Establish tenant context for everything that follows. */
  withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T>;
  /** Insert a batch. Implementations should honour idempotency keys. */
  insert(table: string, rows: Record<string, unknown>[]): Promise<void>;
}

export async function loadThroughSink(graph: SeedGraph, sink: SeedSink): Promise<void> {
  await sink.insert('plans', graph.plans as unknown as Record<string, unknown>[]);
  await sink.insert('tenants', graph.tenants as unknown as Record<string, unknown>[]);
  await sink.insert('metering_snapshots', graph.metering as unknown as Record<string, unknown>[]);
  await sink.insert('platform_invoices', graph.platform_invoices as unknown as Record<string, unknown>[]);
  await sink.insert('impersonation_grants', graph.impersonation_grants as unknown as Record<string, unknown>[]);

  for (const g of graph.by_tenant) {
    await sink.withTenant(g.tenant.id, async () => {
      for (const key of TENANT_TABLE_ORDER) {
        const rows = g[key] as unknown as Record<string, unknown>[];
        if (rows.length > 0) await sink.insert(key, rows);
      }
    });
  }
}
