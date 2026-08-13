-- ============================================================================
-- 0010_communication.sql
--
-- Implements SRS v2.1 Chapter 26 (Communication & Notification Centre,
-- FR-COM-010..060). First module of Volume III's Communication &
-- Operations slice (Chapters 26-28), built after Finance (Chapters 23-25,
-- both passes complete).
--
-- Scope notes (read before extending this):
--   - FR-COM-010/030 (real WhatsApp Business API / SMS aggregator
--     integration) is NOT implemented — there is no Meta Business Solution
--     Provider account or SMS aggregator contract in this environment
--     (both have real external lead time — see the SRS's Appendix E vendor
--     onboarding track, "WhatsApp Business API approval... longest lead
--     time, start first"). Every outbound channel is stubbed the same way
--     finance.service.ts's recordPayment() stubs mobile_money/card: the
--     full data model, template rendering, fallback sequencing and
--     delivery-state tracking all work end to end, but the actual provider
--     call in communication.service.ts throws a clear "not implemented"
--     error rather than pretending to send anything. See that file's
--     header for exactly where the seam is for whoever wires in the real
--     WhatsApp/SMS/email calls once those accounts exist.
--   - FR-COM-050 ("respect... guardian relationships") is simplified
--     because guardians are not a real table yet (student lifecycle's
--     guardians/transfers/discipline, FR-STU-020..040, are documented as
--     not built in the platform status notes) — the same kind of
--     documented gap assessment.service.ts left for teacher-assignment-
--     scoped score entry pending Chapter 17's academic hierarchy.
--     recipient_type/recipient_id below are a generic (type, id) pair with
--     NO foreign key (guardian ids don't reference any real table yet;
--     staff/student ids could FK but are left uniform with guardian for
--     the same reason generated_documents' polymorphic-source design uses
--     typed columns only where every branch is real) — recipient contact
--     details (name/phone/email) are captured directly on the notification
--     at send time instead of joined live from a guardian record.
--   - FR-COM-020's template versioning follows notification_templates'
--     own "one active version per code" invariant, enforced by Postgres
--     via a partial unique index (idx_notification_templates_one_active)
--     — the same DB-enforced-cross-row-invariant instinct as
--     grading_scale_items' EXCLUDE constraint and student_results' partial
--     unique index, rather than trusting application code alone.
--   - FR-COM-050's "stricter minimization and channel restriction" for
--     children's/medical/discipline communication is modelled as a
--     sensitivity_level on both templates and notifications
--     ('normal'/'restricted'/'confidential'); communication.service.ts's
--     send() refuses to attempt WhatsApp/SMS at all for 'confidential'
--     notifications, restricting them to email (the channel of record for
--     durable, sensitive documentation per Chapter 26.1) — a concrete rule,
--     not just a documented TODO.
--   - FR-COM-030's per-tenant monthly SMS cost threshold is schema-ready
--     (tenant_communication_settings, notification_deliveries.cost_amount)
--     but nothing populates a real cost_amount today, since no SMS ever
--     actually sends — same "schema-ready, integration deferred" shape as
--     payments.method/provider/status before Finance Pass 2.
--   - FR-COM-040's scheduled report delivery is NOT built (no job
--     scheduler exists in this scaffold yet); what IS built is the
--     acknowledgeable-report/escalation half of that requirement plus all
--     of FR-COM-060 — notification_reports/notification_report_comments,
--     independent of whether the underlying notification's channel send
--     actually succeeded, because a report is a task assigned to staff to
--     act on in-app, not proof that an external message was received.
-- ============================================================================

create table notification_templates (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  code              text not null,   -- e.g. 'attendance_alert', 'invoice_issued', 'results_published'
  channel           text not null check (channel in ('whatsapp', 'sms', 'email', 'in_app')),
  language          text not null default 'en',
  subject           text,            -- null for channels with no subject line (whatsapp/sms)
  body              text not null,
  -- FR-COM-020: the variable names this template's body references (e.g.
  -- ['studentName','amount']) — previewTemplate() in communication.service.ts
  -- validates a caller-supplied variable set against exactly this list
  -- before any send is attempted.
  variables         jsonb not null default '[]',
  sensitivity_level text not null default 'normal' check (sensitivity_level in ('normal', 'restricted', 'confidential')),
  version           integer not null default 1,
  is_active         boolean not null default true,
  retired_at        timestamptz,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  unique (tenant_id, id),
  unique (tenant_id, code, version)
);
create index idx_notification_templates_tenant on notification_templates (tenant_id);

-- FR-COM-020: at most one active version per (tenant, code) — mirrors
-- 0006_results.sql's idx_student_results_one_current.
create unique index idx_notification_templates_one_active
  on notification_templates (tenant_id, code)
  where is_active;

alter table notification_templates enable row level security;
create policy tenant_isolation_notification_templates on notification_templates
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table communication_preferences (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  recipient_type text not null check (recipient_type in ('guardian', 'staff', 'student')),
  recipient_id   uuid not null,   -- no FK: guardian ids reference no real table yet (see header)
  channel        text not null check (channel in ('whatsapp', 'sms', 'email')),
  opted_in       boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  unique (tenant_id, id),
  unique (tenant_id, recipient_type, recipient_id, channel)
);
create index idx_communication_preferences_tenant on communication_preferences (tenant_id);

alter table communication_preferences enable row level security;
create policy tenant_isolation_communication_preferences on communication_preferences
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table notifications (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  template_id       uuid,
  recipient_type    text not null check (recipient_type in ('guardian', 'staff', 'student')),
  recipient_id      uuid not null,
  -- Snapshot contact details at send time (see header) rather than a live
  -- join to a guardian record that does not exist as a table yet.
  recipient_name    text not null,
  recipient_phone   text,
  recipient_email   text,
  subject           text,
  body              text not null,
  sensitivity_level text not null default 'normal' check (sensitivity_level in ('normal', 'restricted', 'confidential')),
  is_urgent         boolean not null default false,
  status            text not null default 'queued' check (status in ('queued', 'sending', 'delivered', 'exhausted')),
  created_at        timestamptz not null default now(),
  created_by        uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, template_id) references notification_templates (tenant_id, id)
);
create index idx_notifications_tenant on notifications (tenant_id);
create index idx_notifications_tenant_recipient on notifications (tenant_id, recipient_type, recipient_id);

alter table notifications enable row level security;
create policy tenant_isolation_notifications on notifications
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table notification_deliveries (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  notification_id    uuid not null,
  channel            text not null check (channel in ('whatsapp', 'sms', 'email', 'in_app')),
  -- FR-COM-040: order this channel was attempted in the WhatsApp -> SMS ->
  -- email fallback chain for this notification (1 = first attempted).
  attempt_sequence   integer not null,
  status             text not null check (
                        status in ('sent', 'delivered', 'read', 'failed', 'rejected_not_implemented', 'blocked_by_preference', 'blocked_by_sensitivity')
                      ),
  provider_reference text,
  error_message      text,
  -- FR-COM-030: populated by a real SMS aggregator delivery-report webhook
  -- once that integration exists; always null today (see header).
  cost_amount        numeric(8, 4),
  currency           text not null default 'GHS',
  attempted_at       timestamptz not null default now(),
  delivered_at       timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, notification_id, channel),
  foreign key (tenant_id, notification_id) references notifications (tenant_id, id)
);
create index idx_notification_deliveries_tenant on notification_deliveries (tenant_id);
create index idx_notification_deliveries_tenant_notification on notification_deliveries (tenant_id, notification_id);

alter table notification_deliveries enable row level security;
create policy tenant_isolation_notification_deliveries on notification_deliveries
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table tenant_communication_settings (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references tenants(id),
  monthly_sms_cost_threshold  numeric(10, 2) not null,
  alert_threshold_pct         numeric(5, 2) not null default 80,
  currency                    text not null default 'GHS',
  created_at                  timestamptz not null default now(),
  created_by                  uuid,
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid,
  unique (tenant_id, id),
  unique (tenant_id)
);

alter table tenant_communication_settings enable row level security;
create policy tenant_isolation_tenant_communication_settings on tenant_communication_settings
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table notification_reports (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  notification_id      uuid,
  title                text not null,
  description          text,
  owner_user_id        uuid not null,   -- no FK: created_by/actor-style columns are never FK'd elsewhere in this codebase either
  assigned_by          uuid,
  deadline             timestamptz,
  status               text not null default 'open' check (
                          status in ('open', 'acknowledged', 'in_progress', 'completed', 'reopened')
                        ),
  evidence             text,
  -- FR-COM-060: "overdue items escalate through configurable supervision
  -- levels" — level 0 = not escalated; escalateOverdue() in
  -- communication.service.ts increments this and sets escalated_to_user_id.
  escalation_level     integer not null default 0,
  escalated_to_user_id uuid,
  acknowledged_at      timestamptz,
  completed_at         timestamptz,
  reopened_at          timestamptz,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, notification_id) references notifications (tenant_id, id)
);
create index idx_notification_reports_tenant on notification_reports (tenant_id);
create index idx_notification_reports_tenant_owner on notification_reports (tenant_id, owner_user_id);

alter table notification_reports enable row level security;
create policy tenant_isolation_notification_reports on notification_reports
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

create table notification_report_comments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  report_id      uuid not null,
  author_user_id uuid not null,
  comment        text not null,
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, report_id) references notification_reports (tenant_id, id)
);
create index idx_notification_report_comments_tenant on notification_report_comments (tenant_id);
create index idx_notification_report_comments_tenant_report on notification_report_comments (tenant_id, report_id);

alter table notification_report_comments enable row level security;
create policy tenant_isolation_notification_report_comments on notification_report_comments
  using (tenant_id = current_tenant_id())
  with check (tenant_id = current_tenant_id());

grant select, insert, update, delete on
  notification_templates, communication_preferences, notifications, notification_deliveries,
  tenant_communication_settings, notification_reports, notification_report_comments
to pbsms_app;

-- ----------------------------------------------------------------------------
-- Same sanity check as every migration before this one:
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
-- AND relname NOT IN ('plans','tenants','tenant_subscriptions','platform_audit_logs');
-- -- should still return zero rows after this file runs.
--
-- Extra sanity check specific to this migration — confirm the partial
-- unique index actually rejects a second active version of the same code:
-- INSERT INTO notification_templates (tenant_id, code, channel, body, version, is_active)
--   VALUES (current_tenant_id(), '<existing active code>', 'sms', 'x', 2, true);
-- -- should fail with: ERROR: duplicate key value violates unique constraint "idx_notification_templates_one_active"
-- ----------------------------------------------------------------------------
