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
 * TenantContextStore/WorkerTenantConnection to. This function takes a
 * plain `pg.Pool` connected as pbsms_worker (the same pool worker.ts
 * already opens for dequeue_next_job()/etc. — plain grants, see 0048)
 * and queries product_feedback/product_feedback_digests directly.
 */

import { Pool } from 'pg';

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

const CATEGORIES = ['bug', 'feature_request', 'other'] as const;
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
 * Runs the runbook's five queries against the CURRENT full table (a
 * snapshot, not a delta — same shape as Chapter 14's kpi_snapshots) and
 * inserts one product_feedback_digests row, unless there is genuinely
 * nothing new to report since the previous run.
 */
export async function computeAndStoreFeedbackDigest(pool: Pool): Promise<FeedbackDigestResult> {
  const { rows: totalRows } = await pool.query<{ count: string }>('select count(*)::int as count from product_feedback');
  const sourceReportCount = Number(totalRows[0]?.count ?? 0);
  if (sourceReportCount === 0) {
    return { skipped: true, reason: 'no product_feedback rows exist yet' };
  }

  const { rows: lastDigestRows } = await pool.query<{ generated_at: string }>(
    'select generated_at from product_feedback_digests order by generated_at desc limit 1',
  );
  const lastGeneratedAt = lastDigestRows[0]?.generated_at ?? null;

  const { rows: newCountRows } = await pool.query<{ count: string }>(
    lastGeneratedAt
      ? 'select count(*)::int as count from product_feedback where created_at > $1'
      : 'select count(*)::int as count from product_feedback',
    lastGeneratedAt ? [lastGeneratedAt] : [],
  );
  const newReportCount = Number(newCountRows[0]?.count ?? 0);

  if (lastGeneratedAt && newReportCount === 0) {
    return { skipped: true, reason: 'no new product_feedback rows since the last digest' };
  }

  const categorySummary = await computeCategorySummary(pool);
  const roleSummary = await computeRoleSummary(pool);
  const vocabulary = await computeVocabulary(pool);
  const duplicateClusters = await computeDuplicateClusters(pool);

  const { rows: inserted } = await pool.query<{ id: string }>(
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

  return {
    skipped: false,
    digestId: inserted[0].id,
    sourceReportCount,
    newReportCount,
  };
}

// Runbook query 1: volume/reach per category.
async function computeCategorySummary(pool: Pool): Promise<CategorySummaryRow[]> {
  const { rows } = await pool.query<CategorySummaryRow>(`
    select
      category,
      count(*)::text                    as report_count,
      count(distinct tenant_ref)::text  as distinct_tenants,
      min(created_at)                   as first_seen,
      max(created_at)                   as last_seen
    from product_feedback
    group by category
    order by report_count desc
  `);
  return rows;
}

// Runbook query 2: affected roles per category.
async function computeRoleSummary(pool: Pool): Promise<RoleSummaryRow[]> {
  const { rows } = await pool.query<RoleSummaryRow>(`
    select
      category,
      unnest(role_codes) as role_code,
      count(*)::text      as report_count
    from product_feedback
    group by category, role_code
    order by category, report_count desc
  `);
  return rows;
}

// Runbook query 3: top ts_stat vocabulary, one pass per category (a
// bind-parameterised category filter, same query the runbook documents
// running by hand once per category).
async function computeVocabulary(pool: Pool): Promise<Record<string, VocabularyRow[]>> {
  const vocabulary: Record<string, VocabularyRow[]> = {};
  for (const category of CATEGORIES) {
    // category is interpolated, not bound — safe here specifically because
    // it only ever comes from the fixed CATEGORIES whitelist above, never
    // from request input; ts_stat()'s argument is itself a SQL query
    // string, which a normal $-bind parameter can't reach inside.
    const { rows } = await pool.query<VocabularyRow>(
      `
      select word, ndoc as reports_containing, nentry as total_occurrences
      from ts_stat($q$
        select to_tsvector('english', subject || ' ' || message)
        from product_feedback
        where category = '${category}'
      $q$)
      order by ndoc desc
      limit ${VOCABULARY_LIMIT}
    `,
    );
    vocabulary[category] = rows;
  }
  return vocabulary;
}

// Runbook query 5 (the connected-groups form of query 4): near-duplicate
// clusters via pg_trgm similarity, one row per report that has at least
// one near-match.
async function computeDuplicateClusters(pool: Pool): Promise<DuplicateClusterRow[]> {
  const { rows } = await pool.query<DuplicateClusterRow>(
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
    having count(*) > 0
    order by similar_report_count desc
  `,
    [SIMILARITY_THRESHOLD],
  );
  return rows;
}
