-- Chapter 47 (Tenant AI Assistant) stage 1-2 of the chapter's own §47.0.2
-- build-authorization table: "retrieval under RLS, scope enforcement,
-- audit logging — no model in the loop." Cleared to build immediately per
-- that table; this migration is plain schema, not the scope-configuration
-- or retrieval-rules logic EC-005 still bars this Agent from authoring.
--
-- FR-AIT-600 lists question_text, response_text, model_version,
-- validation_outcome, latency_ms and cost among required logged fields —
-- none exist yet at this stage (no model, no NL question). They're
-- nullable here and populated starting at the "Ask" stage (§47.0.2 stage
-- 3, gated on an unresolved model-provider decision); a row with all of
-- them null is a complete stage-1 record, not an incomplete one.
--
-- FR-AIT-600's "school, campus" pair collapses to this repo's existing
-- `schools` table (a tenant is the school GROUP; each `schools` row is
-- one physical campus) — a documented mapping decision, not a missing
-- column.

create table assistant_interactions (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  school_id              uuid,
  academic_year_id       uuid,
  actor_user_id          uuid not null references users(id),
  actor_role_codes       text[] not null default '{}',
  impersonation_grant_id uuid,  -- always null while TEN-055 holds; kept for
                                -- the denial-audit row a blocked attempt writes
  request_category       text not null,
  request_params         jsonb not null default '{}',
  question_text          text,
  retrieved_record_ids   uuid[] not null default '{}',
  result_count           integer,
  result_truncated       boolean,
  response_text          text,
  model_version          text,
  validation_outcome     text,
  latency_ms             integer,
  cost_amount            numeric(12,4),
  cost_currency          text,
  status                 text not null default 'served' check (status in ('served', 'denied')),
  denial_reason          text,
  created_at             timestamptz not null default now(),
  unique (tenant_id, id)
);
create index idx_assistant_interactions_tenant on assistant_interactions (tenant_id);
create index idx_assistant_interactions_tenant_actor on assistant_interactions (tenant_id, actor_user_id);

alter table assistant_interactions enable row level security;
create policy tenant_isolation_assistant_interactions on assistant_interactions
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

-- Append-only: no update/delete grant. An audit trail that can be edited
-- after the fact is not an audit trail.
grant select, insert on assistant_interactions to pbsms_app;

-- ----------------------------------------------------------------------------
-- The "disableable by a tenant administrator, globally or per role, taking
-- effect immediately on active sessions" NFR (§47.13). Checked fresh on
-- every call by whoever implements the retrieval service (no cache), which
-- is what makes "immediately" true without any invalidation machinery.
create table assistant_settings (
  tenant_id            uuid primary key references tenants(id),
  is_enabled           boolean not null default true,
  disabled_role_codes  text[] not null default '{}',
  updated_at           timestamptz not null default now(),
  updated_by           uuid
);

alter table assistant_settings enable row level security;
create policy tenant_isolation_assistant_settings on assistant_settings
  using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());

grant select, insert, update on assistant_settings to pbsms_app;

-- ----------------------------------------------------------------------------
-- Sanity check (same one every migration adding a tenant table leaves):
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs','users','login_attempts');
-- -- should still return zero rows after this file runs.
-- ----------------------------------------------------------------------------
