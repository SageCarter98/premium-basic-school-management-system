-- ============================================================================
-- 0007_promotion_documents.sql
--
-- Implements SRS v2.1 Chapter 22 (Document Engine & Promotion/Completion,
-- FR-DOC-010..030, FR-PRO-010..030). Per Chapter 44.3 this is the module
-- after results management (0006_results.sql) — promotion_decisions reads
-- student_results, generated_documents reads student_results (report
-- cards/transcripts), applicants (admission letters) and
-- promotion_decisions (completion certificates).
--
-- Scope notes (read before extending this):
--   - FR-PRO-020 ("configurable promotion policies by division and class
--     level") is NOT a configurable policy engine here — promotion.service.ts
--     computes system_recommendation with one fixed, documented heuristic
--     (pass -> promote, except a JHS 3 pass -> complete; fail -> repeat).
--     A real per-division/class-level policy table is future scope, same
--     deferral style as every other simplified requirement in this
--     codebase. What IS built for real is the STRUCTURAL separation
--     FR-PRO-020 actually asks for: system_recommendation and decision are
--     two distinct columns, and only a human (via promotion.service.ts's
--     decide()) ever writes the second one.
--   - FR-PRO-030 ("create the next academic-year enrolment only after
--     approval, closing the prior enrolment rather than mutating it")
--     needs no new schema at all — enrolments already has status/
--     end_date/closed_reason (0001_init_tenancy.sql) for exactly this.
--     promotion.service.ts's apply() closes the enrolment tied to
--     source_student_result_id's class+year and opens a new one at
--     to_class_id/to_academic_year_id, the same close-then-open shape
--     admissions.service.ts's convert() uses for applicant->student, not
--     a new pattern.
--   - generated_documents.content is a JSONB SNAPSHOT frozen at generation
--     time — the same "never a live join once something is issued"
--     reasoning as student_result_items (0006_results.sql). There is no
--     PDF/QR-image rendering here: an actual printable document and a
--     scannable QR code are a frontend/rendering concern that would
--     consume this row, not something this backend module produces.
--   - Exactly one of applicant_id / student_result_id / student_id /
--     promotion_decision_id is set per document_type, enforced by the
--     CHECK constraint below — a lightweight polymorphic-source pattern
--     rather than a generic "documentable" join table, since there are
--     only four fixed types (FR-DOC-010 names all four) and each maps to
--     exactly one source table.
--   - tenant_branding is text-only (signatory name/title, an optional
--     school-name override) — FR-DOC-030's letterhead/logo need actual
--     file storage (S3-equivalent), which nothing in this scaffold
--     provisions yet. Documented future scope, not approximated with a
--     free-text URL column that would go stale silently.
--   - verify_document(): FR-DOC-020 requires a THIRD PARTY to verify a
--     document "without contacting the school" — i.e. with no tenant
--     context and no login. Every other read in this codebase goes
--     through RLS via TenantDatabaseService; this is the second
--     legitimate exception to that (the first is login_lookup(), right
--     after tenant_users in 0001_init_tenancy.sql, for the identical
--     reason: the caller has no tenant context YET). Same fix: a narrow,
--     parameterized SECURITY DEFINER function — never a blanket table
--     grant — exposing only what a verifier needs (type, reference,
--     issuing school, dates, revocation status), never the full content
--     JSONB.
-- ============================================================================

-- enrolments (0001_init_tenancy.sql) was created with only
-- `unique (tenant_id, student_id, academic_year_id)` — every other
-- tenant-owned table in this codebase also carries a plain
-- `unique (tenant_id, id)` specifically so later tables can FK to it by
-- (tenant_id, id), the composite-FK pattern 0001's own header mandates.
-- enrolments never needed that until now (nothing referenced it by id
-- before promotion_decisions.new_enrolment_id below). Additive only — no
-- existing column, data, or constraint is touched.
alter table enrolments add constraint enrolments_tenant_id_id_key unique (tenant_id, id);

create table tenant_branding (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  school_name_override text,
  signatory_name       text,
  signatory_title      text,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  -- Single-column unique (one row per tenant, upserted via ON CONFLICT
  -- (tenant_id) in documents.service.ts) — no (tenant_id, id) compound
  -- unique here, unlike every other table in this codebase, because
  -- nothing FKs to tenant_branding by id; that compound only exists
  -- elsewhere to support composite child FKs.
  unique (tenant_id)
);

alter table tenant_branding enable row level security;
create policy tenant_isolation_tenant_branding on tenant_branding
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table promotion_decisions (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id),
  student_id               uuid not null,
  -- FR-PRO-010: "approved annual academic evidence" — must be a specific
  -- published/locked/archived student_results row, never a draft one;
  -- enforced in promotion.service.ts's recommend(), not by a CHECK here
  -- (student_results.status can legitimately change after this FK is
  -- written, e.g. via a later reopen() — the FK only guarantees the row
  -- still exists, not its status at read time).
  source_student_result_id uuid not null,
  system_recommendation    text not null check (system_recommendation in ('promote', 'repeat', 'conditional', 'transfer', 'complete')),
  -- Null until a human calls decide() — FR-PRO-020's system-recommendation
  -- vs. authorized-decision separation is this column existing at all.
  decision                 text check (decision in ('promoted', 'repeated', 'conditional', 'pending', 'transferred', 'completed')),
  status                   text not null default 'recommended' check (status in ('recommended', 'decided', 'applied')),
  decided_at               timestamptz,
  decided_by               uuid,
  -- Required (by promotion.service.ts, not this schema) for
  -- promoted/repeated/conditional; left null for
  -- transferred/completed/pending, which have no PBSMS-side destination
  -- class.
  to_class_id              uuid,
  to_academic_year_id      uuid,
  -- Set by apply() once FR-PRO-030's enrolment close+open actually
  -- happens — null for transferred/completed/pending decisions, which
  -- close the prior enrolment but never open a new one.
  new_enrolment_id         uuid,
  applied_at               timestamptz,
  applied_by               uuid,
  notes                    text,
  created_at               timestamptz not null default now(),
  created_by               uuid,
  updated_at               timestamptz not null default now(),
  updated_by               uuid,
  unique (tenant_id, id),
  -- One decision per piece of evidence — a second recommend() call
  -- against the same source_student_result_id is a duplicate, not a
  -- revision (a genuine revision belongs on a NEW student_results version
  -- via results.service.ts's reopen(), which then gets its own decision).
  unique (tenant_id, student_id, source_student_result_id),
  foreign key (tenant_id, student_id) references students (tenant_id, id),
  foreign key (tenant_id, source_student_result_id) references student_results (tenant_id, id),
  foreign key (tenant_id, to_class_id) references classes (tenant_id, id),
  foreign key (tenant_id, to_academic_year_id) references academic_years (tenant_id, id),
  foreign key (tenant_id, new_enrolment_id) references enrolments (tenant_id, id)
);
create index idx_promotion_decisions_tenant on promotion_decisions (tenant_id);

alter table promotion_decisions enable row level security;
create policy tenant_isolation_promotion_decisions on promotion_decisions
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table generated_documents (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  document_type         text not null check (document_type in ('report_card', 'transcript', 'admission_letter', 'completion_certificate')),
  reference_number      text not null,
  -- An opaque, unguessable value (generated in documents.service.ts via
  -- Node's crypto.randomBytes, not a DB default) — what a QR code would
  -- actually encode. Deliberately NOT the reference_number: that is
  -- human-readable and sequential (see documents.service.ts), so using it
  -- for verification would let a third party enumerate other tenants'
  -- documents by guessing nearby numbers.
  verification_token    text not null,
  applicant_id          uuid,
  student_result_id     uuid,
  student_id            uuid,
  promotion_decision_id uuid,
  content               jsonb not null,
  generated_at          timestamptz not null default now(),
  generated_by          uuid,
  revoked_at            timestamptz,
  revoked_by            uuid,
  revoke_reason         text,
  unique (tenant_id, id),
  unique (tenant_id, reference_number),
  unique (tenant_id, verification_token),
  foreign key (tenant_id, applicant_id) references applicants (tenant_id, id),
  foreign key (tenant_id, student_result_id) references student_results (tenant_id, id),
  foreign key (tenant_id, student_id) references students (tenant_id, id),
  foreign key (tenant_id, promotion_decision_id) references promotion_decisions (tenant_id, id),
  -- Named explicitly (unlike this codebase's other inline CHECKs) because
  -- 0008_finance.sql needs to DROP and widen this exact constraint to add
  -- a 5th document_type ('receipt') — an unnamed table-level CHECK gets an
  -- unpredictable auto-generated name, which a later migration can't
  -- safely target.
  constraint generated_documents_source_check check (
    (document_type = 'admission_letter' and applicant_id is not null and student_result_id is null and student_id is null and promotion_decision_id is null)
    or (document_type = 'report_card' and student_result_id is not null and applicant_id is null and student_id is null and promotion_decision_id is null)
    or (document_type = 'transcript' and student_id is not null and applicant_id is null and student_result_id is null and promotion_decision_id is null)
    or (document_type = 'completion_certificate' and promotion_decision_id is not null and applicant_id is null and student_result_id is null and student_id is null)
  )
);
create index idx_generated_documents_tenant on generated_documents (tenant_id);

alter table generated_documents enable row level security;
create policy tenant_isolation_generated_documents on generated_documents
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on tenant_branding, promotion_decisions, generated_documents to pbsms_app;

-- ----------------------------------------------------------------------------
-- verify_document(): see this migration's header for why this exists and
-- why it deliberately returns only a curated subset of columns, never
-- `content`. Mirrors login_lookup() in 0001_init_tenancy.sql exactly —
-- SECURITY DEFINER, owned by the migration role (which, as table owner,
-- bypasses RLS), so pbsms_app can call it with no tenant context set.
-- ----------------------------------------------------------------------------
create or replace function verify_document(p_token text)
returns table (
  document_type    text,
  reference_number text,
  tenant_name      text,
  generated_at     timestamptz,
  revoked_at       timestamptz
)
language sql
security definer
set search_path = public
as $$
  select gd.document_type, gd.reference_number, t.name as tenant_name, gd.generated_at, gd.revoked_at
  from generated_documents gd
  join tenants t on t.id = gd.tenant_id
  where gd.verification_token = p_token
  limit 1
$$;

revoke all on function verify_document(text) from public;
grant execute on function verify_document(text) to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
--
-- Extra sanity check specific to this migration — confirm verify_document()
-- actually works with NO tenant context set (the whole point of it):
-- \c pbsms pbsms_app
-- RESET app.current_tenant;
-- SELECT * FROM verify_document('<some verification_token>');
-- -- should return one row despite no app.current_tenant being set, while
-- -- SELECT * FROM generated_documents; in the same session returns zero.
-- ----------------------------------------------------------------------------
