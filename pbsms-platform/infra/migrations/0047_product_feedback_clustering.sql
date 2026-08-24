-- ============================================================================
-- 0047_product_feedback_clustering.sql
--
-- Settles the EC-100/101 clustering question raised against
-- 0046_product_feedback.sql: cluster in the database, not via an external
-- NLP/embedding call. Two real, native Postgres capabilities cover most
-- of what EC-101's "impact ranking" needs without a single byte of
-- feedback text ever leaving this database — which also sidesteps the
-- DP-103-style third-party-data-handling decision an embedding-based
-- approach would have reopened for Model B's own tooling.
--
-- pg_trgm (trigram similarity) finds near-duplicate reports even when
-- worded differently ("invoice export blank" / "invoice export shows a
-- blank page"). Postgres's built-in full-text statistics (ts_stat) surface
-- the most common words per category. Neither is true semantic
-- understanding — two reports describing the same bug in genuinely
-- different vocabulary ("the export button doesn't work" vs. "can't get
-- my invoice as a PDF") will not be linked by either technique. That
-- ceiling is real and stated, not silently assumed away; see
-- infra/queries/product_feedback_clustering.sql for the actual queries
-- and this same note repeated there for whoever runs them.
-- ============================================================================

create extension if not exists pg_trgm;

-- GIN trigram index on the combined subject+message text, so similarity()
-- queries in the runbook don't force a sequential scan as this table grows.
create index idx_product_feedback_text_trgm
  on product_feedback using gin ((subject || ' ' || message) gin_trgm_ops);

-- Least-privilege read grant for the Engineering Lead's own tooling —
-- same category as every other platform-review grant in this codebase
-- (billing/tenant_applications review both use pbsms_platform, never the
-- schema-owning migrate role, for exactly this "read platform data, no
-- write path" shape). Today this is used by a human running the runbook
-- queries directly; it's also the correct grant for a future read API if
-- one is ever built, so it doesn't need redoing then.
grant select on product_feedback to pbsms_platform;
