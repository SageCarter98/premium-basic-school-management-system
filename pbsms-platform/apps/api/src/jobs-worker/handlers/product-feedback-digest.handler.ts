/**
 * product-feedback-digest.handler.ts — the EC-100/101 scheduled job
 * CLAUDE.md names as the deliberate remaining gap: turns
 * infra/queries/product_feedback_clustering.sql's runbook (previously a
 * human running four queries by hand) into something worker.ts runs on
 * its own timer, writing one product_feedback_digests row (0048) per run.
 *
 * Deliberately NOT dispatched through worker.ts's runHandler()/
 * dequeue_next_job() path like every other handler in this directory —
 * this isn't a background_jobs row at all. product_feedback has no
 * tenant_id (0046's whole point), so there's no tenant to scope a
 * TenantContextStore/WorkerTenantConnection to. This function checks out
 * a single connection from the pbsms_worker pool worker.ts already opens
 * for dequeue_next_job()/etc. (plain grants, see 0048) and runs the
 * whole digest inside one REPEATABLE READ transaction — every query
 * below, including the two "is there anything new" checks, reads the
 * exact same snapshot of product_feedback, so the digest's own headline
 * counts always reconcile with its category/role/vocabulary/duplicate-
 * cluster breakdowns even if a report is submitted mid-run.
 */

import { Pool, PoolClient } from 'pg';

interface CategorySummaryRow {
  category: string;
  report_count: string;
  distinct_tenants: string;
  first_seen: string;
  last_seen: string;
}

interface RoleSummaryRow {
  category: string;
  role_code: string;
  report_count: string;
}

interface VocabularyRow {
  word: string;
  reports_containing: number;
  total_occurrences: number;
}

interface DuplicateClusterRow {
  id: string;
  category: string;
  subject: string;
  similar_report_count: string;
  similar_to: string[];
}

const SIMILARITY_THRESHOLD = 0.3;
const VOCABULARY_LIMIT = 25;

export interface FeedbackDigestResult {
  skipped: boolean;
  reason?: string;
  digestId?: string;
  sourceReportCount?: number;
  newReportCount?: number;
}

/**
 * Runs the runbook's queries against the CURRENT full table (a snapshot,
 * not a delta — same shape as Chapter 14's kpi_snapshots) and inserts one
 * product_feedback_digests row, unless there is genuinely nothing new to
 * report since the previous run.
 */
export async function computeAndStoreFeedbackDigest(pool: Pool): Promise<FeedbackDigestResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

    const { rows: totalRows } = await client.query<{ count: string }>('select count(*)::int as count from product_feedback');
    const sourceReportCount = Number(totalRows[0]?.count ?? 0);
    if (sourceReportCount === 0) {
      await client.query('COMMIT');
      return { skipped: true, reason: 'no product_feedback rows exist yet' };
    }

    const { rows: lastDigestRows } = await client.query<{ generated_at: string }>(
      'select generated_at from product_feedback_digests order by generated_at desc limit 1',
    );
    const lastGeneratedAt = lastDigestRows[0]?.generated_at ?? null;

    const { rows: newCountRows } = await client.query<{ count: string }>(
      lastGeneratedAt
        ? 'select count(*)::int as count from product_feedback where created_at > $1'
        : 'select count(*)::int as count from product_feedback',
      lastGeneratedAt ? [lastGeneratedAt] : [],
    );
    const newReportCount = Number(newCountRows[0]?.count ?? 0);

    if (lastGeneratedAt && newReportCount === 0) {
      await client.query('COMMIT');
      return { skipped: true, reason: 'no new product_feedback rows since the last digest' };
    }

    // Every query from here on shares this one transactional connection,
    // so they necessarily run one at a time no matter how they're awaited
    // — a single Postgres connection processes one query at a time.
    // Firing them concurrently (e.g. Promise.all) would only queue
    // client-side with no real wall-clock benefit, and splitting them
    // across separate connections would break the single-snapshot
    // consistency this transaction exists for. Sequential awaits here are
    // the correct shape, not an oversight.
    const categories = await computeCategories(client);
    const categorySummary = await computeCategorySummary(client);
    const roleSummary = await computeRoleSummary(client);
    const vocabulary = await computeVocabulary(client, categories);
    const duplicateClusters = await computeDuplicateClusters(client);

    const { rows: inserted } = await client.query<{ id: string }>(
      `insert into product_feedback_digests
         (source_report_count, new_report_count, category_summary, role_summary, vocabulary, duplicate_clusters)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [
        sourceReportCount,
        newReportCount,
        JSON.stringify(categorySummary),
        JSON.stringify(roleSummary),
        JSON.stringify(vocabulary),
        JSON.stringify(duplicateClusters),
      ],
    );

    await client.query('COMMIT');

    return {
      skipped: false,
      digestId: inserted[0].id,
      sourceReportCount,
      newReportCount,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// Distinct categories actually present right now — read from the data
// rather than a hardcoded list, so a future migration widening
// product_feedback's category CHECK constraint (0046) doesn't silently
// leave a new category out of every digest's vocabulary breakdown.
async function computeCategories(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ category: string }>('select distinct category from product_feedback order by category');
  return rows.map((row) => row.category);
}

// Runbook query 1: volume/reach per category. report_count/distinct_tenants
// are cast to ::text for JSON storage, but ORDER BY uses the underlying
// count(*) directly — sorting on the ::text alias would rank lexically
// ('12' before '3'), silently inverting "top category by volume" the
// moment any category reaches double digits.
async function computeCategorySummary(client: PoolClient): Promise<CategorySummaryRow[]> {
  const { rows } = await client.query<CategorySummaryRow>(`
    select
      category,
      count(*)::text                    as report_count,
      count(distinct tenant_ref)::text  as distinct_tenants,
      min(created_at)                   as first_seen,
      max(created_at)                   as last_seen
    from product_feedback
    group by category
    order by count(*) desc
  `);
  return rows;
}

// Runbook query 2: affected roles per category. Same text-cast-for-storage-
// but-sort-on-the-real-count reasoning as computeCategorySummary above.
async function computeRoleSummary(client: PoolClient): Promise<RoleSummaryRow[]> {
  const { rows } = await client.query<RoleSummaryRow>(`
    select
      category,
      unnest(role_codes) as role_code,
      count(*)::text      as report_count
    from product_feedback
    group by category, role_code
    order by category, count(*) desc
  `);
  return rows;
}

// Runbook query 3: top ts_stat vocabulary, one pass per category present
// in the data (computeCategories above).
async function computeVocabulary(client: PoolClient, categories: string[]): Promise<Record<string, VocabularyRow[]>> {
  const vocabulary: Record<string, VocabularyRow[]> = {};
  for (const category of categories) {
    // category and the vocabulary limit are bound as real query parameters
    // ($1/$2) and spliced into the dynamic ts_stat() query text via
    // format()'s %L (literal-quoting) rather than string-interpolated by
    // application code — safe regardless of where `category` came from,
    // not just because it currently only ever comes from
    // computeCategories()'s own DB read. ts_stat()'s own argument is
    // itself a SQL query string, which a normal $-bind parameter can't
    // reach directly — format() is the safe way to build it dynamically.
    const { rows } = await client.query<VocabularyRow>(
      `
      select word, ndoc as reports_containing, nentry as total_occurrences
      from ts_stat(format($fmt$
        select to_tsvector('english', subject || ' ' || message)
        from product_feedback
        where category = %L
      $fmt$, $1::text))
      order by ndoc desc
      limit $2
    `,
      [category, VOCABULARY_LIMIT],
    );
    vocabulary[category] = rows;
  }
  return vocabulary;
}

// Runbook query 5 (the connected-groups form of query 4): near-duplicate
// clusters via pg_trgm similarity, one row per report that has at least
// one near-match. No HAVING clause needed — the JOIN's own ON condition
// already guarantees every surviving group has at least one match.
async function computeDuplicateClusters(client: PoolClient): Promise<DuplicateClusterRow[]> {
  const { rows } = await client.query<DuplicateClusterRow>(
    `
    select
      a.id,
      a.category,
      a.subject,
      count(*)::text as similar_report_count,
      array_agg(b.id order by similarity(a.subject || ' ' || a.message, b.subject || ' ' || b.message) desc) as similar_to
    from product_feedback a
    join product_feedback b
      on a.category = b.category
      and a.id <> b.id
      and similarity(a.subject || ' ' || a.message, b.subject || ' ' || b.message) > $1
    group by a.id, a.category, a.subject
    order by count(*) desc
  `,
    [SIMILARITY_THRESHOLD],
  );
  return rows;
}
