import type { SeedConfig } from './config.js';
import { daysBetween } from './rng.js';

const at2 = (d: string) => `${d}T00:00:00.000Z`;
import type { SeedGraph, TenantGraph } from './types.js';

/**
 * A seed generator that emits a subtly wrong graph is worse than no generator,
 * because every test built on it inherits the error and then encodes it as the
 * expected result. These checks run on every build. A failure is fatal.
 *
 * The cross-tenant reference check (I2) is the one that matters most: it is the
 * fixture-level analogue of NFR-QA-020. If a fixture row in tenant A points at
 * a row in tenant B, an isolation test can pass for the wrong reason.
 */

export interface Violation {
  code: string;
  detail: string;
}

const ID_LIKE = /^[a-z]{3,4}_/;
/** Values that look like ids but legitimately do not resolve inside a tenant. */
const NON_ENTITY = new Set(['system', 'n/a', 'pfm_support_01', 'pfm_support_02']);
/** Keys ending in _id that are not intra-tenant foreign keys. */
const NOT_FK = new Set(['tenant_id', 'device_id']);

function collectIds(g: TenantGraph): Set<string> {
  const ids = new Set<string>();
  for (const v of Object.values(g)) {
    if (!Array.isArray(v)) continue;
    for (const row of v) if (row && typeof row.id === 'string') ids.add(row.id);
  }
  return ids;
}

export function check(graph: SeedGraph, cfg: SeedConfig): Violation[] {
  const v: Violation[] = [];
  const add = (code: string, detail: string) => v.push({ code, detail });

  const tenantIds = new Set(graph.tenants.map((t) => t.id));
  const allIds = new Map<string, string>(); // id -> owning tenant

  /* I1 — every tenant-owned row carries the right tenant_id, and ids are globally unique */
  for (const g of graph.by_tenant) {
    for (const [table, rows] of Object.entries(g)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (row.tenant_id !== g.tenant.id) {
          add('I1_TENANT_ID', `${table}/${row.id}: tenant_id=${row.tenant_id}, expected ${g.tenant.id}`);
        }
        if (allIds.has(row.id)) {
          add('I1_DUPLICATE_ID', `${row.id} appears in ${allIds.get(row.id)} and ${g.tenant.id}`);
        }
        allIds.set(row.id, g.tenant.id);
      }
    }
  }

  /* I2 — no foreign key crosses a tenant boundary */
  for (const g of graph.by_tenant) {
    const own = collectIds(g);
    for (const [table, rows] of Object.entries(g)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        for (const [key, value] of Object.entries(row)) {
          if (!key.endsWith('_id') || NOT_FK.has(key)) continue;
          if (typeof value !== 'string' || value === '' || NON_ENTITY.has(value)) continue;
          if (tenantIds.has(value)) continue; // audit rows legitimately point at the tenant
          if (!ID_LIKE.test(value)) continue;
          if (!own.has(value)) {
            const owner = allIds.get(value);
            add('I2_CROSS_TENANT_FK', `${table}/${row.id}.${key} -> ${value}${owner ? ` (owned by ${owner})` : ' (dangling)'}`);
          }
        }
        // Array-valued references, e.g. subject.division_ids
        for (const [key, value] of Object.entries(row)) {
          if (!key.endsWith('_ids') || !Array.isArray(value)) continue;
          for (const item of value) {
            if (typeof item === 'string' && ID_LIKE.test(item) && !own.has(item)) {
              add('I2_CROSS_TENANT_FK', `${table}/${row.id}.${key} -> ${item}`);
            }
          }
        }
      }
    }
  }

  /* per-tenant domain invariants */
  for (const g of graph.by_tenant) {
    const t = g.tenant.id;

    /* I3 — money never over-allocates */
    for (const line of g.invoice_lines) {
      const allocated = g.allocations.filter((a) => a.invoice_line_id === line.id).reduce((s, a) => s + a.amount, 0);
      if (allocated > line.amount) {
        add('I3_OVER_ALLOCATED_LINE', `${t}: line ${line.id} allocated ${allocated} > ${line.amount}`);
      }
    }
    for (const p of g.payments) {
      if (p.amount < 0) continue; // reversal entries
      const allocated = g.allocations.filter((a) => a.payment_id === p.id).reduce((s, a) => s + a.amount, 0);
      if (allocated > p.amount) {
        add('I3_OVER_ALLOCATED_PAYMENT', `${t}: payment ${p.id} allocated ${allocated} > ${p.amount}`);
      }
    }
    for (const inv of g.invoices) {
      const sum = g.invoice_lines.filter((l) => l.invoice_id === inv.id).reduce((s, l) => s + l.amount, 0);
      if (sum !== inv.total) add('I3_INVOICE_TOTAL', `${t}: invoice ${inv.id} total ${inv.total} != line sum ${sum}`);
      if (!Number.isInteger(inv.total)) add('I3_FLOAT_MONEY', `${t}: invoice ${inv.id} total is not an integer`);
    }

    /* I4 — exactly one current result version per published set, superseded ones retained */
    for (const set of g.result_sets.filter((r) => r.state === 'published')) {
      const versions = g.result_versions.filter((x) => x.result_set_id === set.id);
      if (versions.length === 0) { add('I4_NO_VERSION', `${t}: published set ${set.id} has no version`); continue; }
      const current = versions.filter((x) => x.is_current);
      if (current.length !== 1) add('I4_CURRENT_COUNT', `${t}: set ${set.id} has ${current.length} current versions`);
      for (const ver of versions) {
        if (g.result_lines.filter((l) => l.result_version_id === ver.id).length === 0) {
          add('I4_EMPTY_VERSION', `${t}: version ${ver.id} has no lines`);
        }
      }
      const superseding = versions.filter((x) => x.supersedes_version_id !== null);
      for (const s of superseding) {
        if (!s.reopen_reason) add('I4_NO_REOPEN_REASON', `${t}: version ${s.id} supersedes without a reason`);
        if (!s.reopen_authorised_by) add('I4_NO_REOPEN_AUTHORITY', `${t}: version ${s.id} supersedes without an authoriser`);
      }
    }

    /* I5 — reversal is maker-checker and additive */
    for (const p of g.payments.filter((x) => x.reverses_payment_id !== null)) {
      const orig = g.payments.find((x) => x.id === p.reverses_payment_id);
      if (!orig) { add('I5_MISSING_ORIGINAL', `${t}: reversal ${p.id} has no original`); continue; }
      if (orig.state !== 'reversed') add('I5_ORIGINAL_STATE', `${t}: original ${orig.id} is ${orig.state}, expected reversed`);
      if (p.amount !== -orig.amount) add('I5_AMOUNT', `${t}: reversal ${p.id} amount ${p.amount} != -${orig.amount}`);
      if (!p.reversal_requested_by || !p.reversal_approved_by) add('I5_NO_MAKER_CHECKER', `${t}: reversal ${p.id} missing requester or approver`);
      if (p.reversal_requested_by === p.reversal_approved_by) add('I5_SAME_PERSON', `${t}: reversal ${p.id} approved by its own requester`);
    }

    /* I6 — settlement arithmetic: net short by exactly the fee is correct */
    for (const s of g.provider_settlements) {
      if (s.net_amount !== s.gross_amount - s.fee_amount) {
        add('I6_SETTLEMENT_MATH', `${t}: settlement ${s.id} net ${s.net_amount} != ${s.gross_amount} - ${s.fee_amount}`);
      }
    }

    /* I7 — guardian cardinality behaves as configured */
    const seenPairs = new Set<string>();
    for (const l of g.guardian_links) {
      const pair = `${l.guardian_id}|${l.student_id}`;
      if (seenPairs.has(pair)) add('I7_DUPLICATE_LINK', `${t}: guardian ${l.guardian_id} linked to student ${l.student_id} twice`);
      seenPairs.add(pair);
    }
    const linksByStudent = new Map<string, number>();
    for (const l of g.guardian_links) linksByStudent.set(l.student_id, (linksByStudent.get(l.student_id) ?? 0) + 1);
    const multi = [...linksByStudent.values()].filter((n) => n > 1).length;
    if (cfg.guardianCardinality === 'one_to_many' && multi > 0) {
      add('I7_CARDINALITY', `${t}: ${multi} students have more than one guardian under one_to_many`);
    }
    if (cfg.guardianCardinality === 'many_to_many' && multi === 0) {
      add('I7_NO_PROBE', `${t}: many_to_many configured but no student has a second guardian — the FR-STU-020 probe is missing`);
    }
    for (const s of g.students) {
      if (!linksByStudent.has(s.id)) add('I7_ORPHAN_STUDENT', `${t}: student ${s.id} has no guardian`);
    }

    /* I8 — attendance corrections retain the original, conflicts stay open */
    const corrections = g.attendance_records.filter((a) => a.corrects_record_id !== null);
    if (corrections.length === 0) add('I8_NO_CORRECTION', `${t}: no attendance correction in the fixture`);
    for (const c of corrections) {
      if (!g.attendance_records.some((a) => a.id === c.corrects_record_id)) {
        add('I8_LOST_ORIGINAL', `${t}: correction ${c.id} points at a missing original`);
      }
      if (!c.correction_reason) add('I8_NO_REASON', `${t}: correction ${c.id} has no reason`);
    }
    if (g.attendance_conflicts.length === 0) add('I8_NO_CONFLICT', `${t}: no attendance conflict in the fixture`);
    for (const c of g.attendance_conflicts) {
      const a = g.attendance_records.find((x) => x.id === c.record_a_id);
      const b = g.attendance_records.find((x) => x.id === c.record_b_id);
      if (!a || !b) { add('I8_CONFLICT_REFS', `${t}: conflict ${c.id} references a missing record`); continue; }
      if (a.status === b.status) add('I8_NOT_A_CONFLICT', `${t}: conflict ${c.id} has identical statuses`);
      if (a.marked_by === b.marked_by) add('I8_SAME_MARKER', `${t}: conflict ${c.id} is same-user, not cross-user`);
      if (c.state !== 'open') add('I8_AUTO_RESOLVED', `${t}: conflict ${c.id} is pre-resolved; FR-ATT-011 requires manual reconciliation`);
    }
    if (!g.attendance_records.some((a) => a.captured_offline && a.synced_at === null)) {
      add('I8_NO_PENDING_SYNC', `${t}: no unsynced offline attendance — the SyncLedger has nothing to display`);
    }

    /* I9 — consent suppression is distinct from delivery failure */
    const suppressed = g.message_deliveries.filter((d) => d.state === 'suppressed_no_consent');
    if (g.message_deliveries.length > 0 && suppressed.length === 0) {
      add('I9_NO_SUPPRESSION', `${t}: no suppressed-for-consent delivery (DP-070 path untested)`);
    }
    for (const d of suppressed) {
      const batch = g.message_batches.find((b) => b.id === d.batch_id)!;
      const consent = g.consent_records.find((c) => c.guardian_id === d.guardian_id && c.channel === batch.channel);
      if (consent && consent.granted) {
        add('I9_SUPPRESSED_WITH_CONSENT', `${t}: delivery ${d.id} suppressed but consent is granted`);
      }
      if (d.failure_reason !== null) add('I9_SUPPRESSED_AS_FAILURE', `${t}: delivery ${d.id} conflates suppression with failure`);
    }

    /* I10 — data subject requests are on a 30-day clock */
    for (const r of g.data_subject_requests) {
      if (daysBetween(r.received_on, r.due_on) !== 30) {
        add('I10_DSR_SLA', `${t}: request ${r.id} due ${r.due_on} is not 30 days after ${r.received_on}`);
      }
    }

    /* I11 — enrolment integrity */
    for (const e of g.enrolments) {
      const cls = g.classes.find((c) => c.id === e.class_id);
      if (!cls) { add('I11_MISSING_CLASS', `${t}: enrolment ${e.id} has no class`); continue; }
      if (cls.academic_year_id !== e.academic_year_id) {
        add('I11_YEAR_MISMATCH', `${t}: enrolment ${e.id} year does not match its class`);
      }
      if (cls.campus_id !== e.campus_id) add('I11_CAMPUS_MISMATCH', `${t}: enrolment ${e.id} campus does not match its class`);
      if (e.ended_on && e.ended_on < e.started_on) add('I11_NEGATIVE_SPAN', `${t}: enrolment ${e.id} ends before it starts`);
      if (e.is_current && e.ended_on !== null) add('I11_CURRENT_ENDED', `${t}: enrolment ${e.id} is current but has an end date`);
    }

    /* I12 — the deliberate probes are actually present */
    if (!g.invoice_lines.some((l) => l.prorated_from !== null)) {
      add('I12_NO_PRORATION', `${t}: no prorated invoice line — FR-FEE-030 has no subject`);
    }
    const creditPayments = g.payments.filter(
      (p) => p.amount > 0 && p.state === 'confirmed' && !g.allocations.some((a) => a.payment_id === p.id),
    );
    if (creditPayments.length === 0) add('I12_NO_UNALLOCATED_CREDIT', `${t}: no unallocated credit in the fixture`);
    if (!g.students.some((s) => s.has_restricted_health_record)) {
      add('I12_NO_RESTRICTED_RECORD', `${t}: no restricted health record`);
    }
    const leavers = g.students.filter((s) => s.status === 'transferred_out');
    if (leavers.length === 0) add('I12_NO_LEAVER', `${t}: no transferred-out student`);
    if (!g.audit_events.some((a) => a.actor_kind === 'platform')) {
      add('I12_NO_PLATFORM_AUDIT', `${t}: no platform action in the tenant-visible audit log (TEN-022)`);
    }


    /* I16 — identity integrity */
    const staffById = new Map(g.staff.map((x) => [x.id, x]));
    const studentById = new Map(g.students.map((x) => [x.id, x]));
    const guardianById = new Map(g.guardians.map((x) => [x.id, x]));
    const rolesByUser = new Map<string, typeof g.user_roles>();
    for (const r of g.user_roles) {
      const list = rolesByUser.get(r.user_id) ?? [];
      list.push(r);
      rolesByUser.set(r.user_id, list);
    }

    const emailsInTenant = new Map<string, string>();
    for (const u of g.users) {
      const subject = u.subject_kind === 'staff' ? staffById.get(u.subject_id)
        : u.subject_kind === 'student' ? studentById.get(u.subject_id)
          : guardianById.get(u.subject_id);
      if (!subject) add('I16_ORPHAN_USER', `${t}: user ${u.id} has no ${u.subject_kind} subject ${u.subject_id}`);

      if (u.login_email) {
        const prior = emailsInTenant.get(u.login_email.toLowerCase());
        if (prior) add('I16_DUPLICATE_EMAIL_IN_TENANT', `${t}: ${u.login_email} used by ${prior} and ${u.id}`);
        emailsInTenant.set(u.login_email.toLowerCase(), u.id);
      }
      if (!u.login_email && !u.login_phone && u.subject_kind !== 'student') {
        add('I16_NO_IDENTIFIER', `${t}: user ${u.id} has neither an email nor a phone to log in with`);
      }

      // A credential that exists must be usable; one that does not must be absent.
      if (u.auth_method === 'password' && u.status === 'active' && !u.password_hash) {
        add('I16_ACTIVE_NO_HASH', `${t}: active password user ${u.id} has no hash`);
      }
      if (u.status === 'invited' && u.password_hash) {
        add('I16_INVITED_HAS_HASH', `${t}: invited user ${u.id} already has a hash`);
      }
      if (u.auth_method === 'otp' && u.password_hash) {
        add('I16_OTP_HAS_HASH', `${t}: OTP user ${u.id} carries a password hash`);
      }
      if (u.status === 'locked' && !u.locked_until) {
        add('I16_LOCKED_NO_UNTIL', `${t}: locked user ${u.id} has no locked_until`);
      }
      if (u.mfa_enabled !== (u.mfa_secret !== null)) {
        add('I16_MFA_MISMATCH', `${t}: user ${u.id} mfa_enabled=${u.mfa_enabled} but secret=${u.mfa_secret === null ? 'null' : 'set'}`);
      }
      if (u.password_hash && cfg.hashMode === 'scrypt' && !u.password_hash.startsWith('scrypt$')) {
        add('I16_BAD_HASH_FORMAT', `${t}: user ${u.id} hash is not scrypt-formatted`);
      }
      if (u.password_hash && cfg.hashMode === 'none' && !u.password_hash.startsWith('plain:')) {
        add('I16_BAD_PLAINTEXT_FORMAT', `${t}: user ${u.id} should carry a plaintext marker`);
      }
      if (u.subject_kind === 'staff' && (rolesByUser.get(u.id) ?? []).length === 0) {
        add('I16_STAFF_NO_ROLE', `${t}: staff user ${u.id} has no role`);
      }
    }

    for (const r of g.user_roles) {
      if (r.scope_kind !== 'tenant' && !r.scope_id) {
        add('I16_ROLE_NO_SCOPE', `${t}: role ${r.id} is ${r.scope_kind}-scoped with a null scope_id`);
      }
      if (r.role === 'teacher' && r.scope_kind !== 'class') {
        add('I16_TEACHER_SCOPE', `${t}: teacher role ${r.id} is ${r.scope_kind}-scoped, not class-scoped`);
      }
    }

    /* every staff member can log in — the gap that prompted this generator */
    for (const st of g.staff) {
      if (!g.users.some((u) => u.subject_kind === 'staff' && u.subject_id === st.id)) {
        add('I16_STAFF_NO_LOGIN', `${t}: staff ${st.id} has no user account`);
      }
    }

    /* I17 — the auth edge cases exist */
    const probes = new Set(g.users.map((u) => u.probe).filter(Boolean) as string[]);
    for (const needed of ['locked_account', 'never_activated', 'departed_staff', 'conflict_of_interest']) {
      if (!probes.has(needed)) add('I17_MISSING_AUTH_PROBE', `${t}: no user carries probe "${needed}"`);
    }
    if (g.invitations.length === 0) add('I17_NO_INVITATION', `${t}: no pending invitation`);
    for (const inv of g.invitations) {
      if (inv.accepted_at === null && inv.expires_at < graph.meta.generated_at) {
        add('I17_ONLY_EXPIRED_INVITE', `${t}: invitation ${inv.id} is unaccepted and already expired`);
      }
    }

    const now = at2(cfg.asOf);
    const resets = g.password_reset_tokens;
    if (!resets.some((r) => r.used_at === null && r.expires_at > now)) add('I17_NO_LIVE_RESET', `${t}: no live password reset token`);
    if (!resets.some((r) => r.used_at === null && r.expires_at <= now)) add('I17_NO_EXPIRED_RESET', `${t}: no expired password reset token`);
    if (!resets.some((r) => r.used_at !== null)) add('I17_NO_USED_RESET', `${t}: no consumed password reset token`);

    const alk = g.access_links;
    if (!alk.some((l) => l.used_at === null && l.expires_at > now)) add('I17_NO_LIVE_LINK', `${t}: no live parent access link`);
    if (!alk.some((l) => l.used_at === null && l.expires_at <= now)) add('I17_NO_EXPIRED_LINK', `${t}: no expired parent access link`);
    if (!alk.some((l) => l.used_at !== null)) add('I17_NO_USED_LINK', `${t}: no consumed parent access link`);
    if (!g.users.some((u) => u.mfa_enabled)) add('I17_NO_MFA', `${t}: no MFA-enabled user`);

    const coi = g.users.find((u) => u.probe === 'conflict_of_interest');
    if (coi) {
      const roles = new Set((rolesByUser.get(coi.id) ?? []).map((r) => r.role));
      if (!(roles.has('accountant') && roles.has('headmaster'))) {
        add('I17_COI_NOT_CONFLICTING', `${t}: conflict-of-interest probe ${coi.id} does not actually hold both roles`);
      }
    }

    /* I13 — assessment weighting */
    const byYear = new Map<string, number>();
    for (const c of g.assessment_components) {
      byYear.set(c.school_id, (byYear.get(c.school_id) ?? 0) + c.weight_percent);
    }
    for (const [schoolId, total] of byYear) {
      const flagged = g.assessment_components.some((c) => c.school_id === schoolId && c.probe !== null);
      if (total !== 100 && !flagged) {
        add('I13_UNFLAGGED_WEIGHTS', `${t}: school ${schoolId} weights total ${total} with no probe marker`);
      }
      if (total === 100 && flagged) {
        add('I13_FALSE_PROBE', `${t}: school ${schoolId} is marked as a weighting probe but totals 100`);
      }
    }
  }

  /* I14 — a suspended tenant must have something that suspended it */
  for (const tenant of graph.tenants.filter((x) => x.status === 'suspended')) {
    const overdue = graph.platform_invoices.filter((i) => i.tenant_id === tenant.id && i.status === 'overdue');
    if (overdue.length === 0) add('I14_SUSPENDED_NO_CAUSE', `${tenant.id} is suspended with no overdue platform invoice`);
    if (!tenant.suspended_at || !tenant.suspension_reason) add('I14_SUSPENDED_NO_RECORD', `${tenant.id} is suspended without a timestamp or reason`);
  }

  /* I18 — exactly one email deliberately reused across tenants */
  const emailOwners = new Map<string, string[]>();
  for (const g of graph.by_tenant) {
    for (const u of g.users) {
      if (!u.login_email) continue;
      const k = u.login_email.toLowerCase();
      const list = emailOwners.get(k) ?? [];
      if (!list.includes(g.tenant.id)) list.push(g.tenant.id);
      emailOwners.set(k, list);
    }
  }
  const shared = [...emailOwners.entries()].filter(([, owners]) => owners.length > 1);
  if (shared.length === 0) {
    add('I18_NO_SHARED_EMAIL', 'no email is reused across tenants; the (tenant_id, login_email) uniqueness question goes untested');
  }
  for (const [email, owners] of shared) {
    const probed = graph.by_tenant.some((g) =>
      g.users.some((u) => u.login_email?.toLowerCase() === email && u.probe === 'email_reused_across_tenants'));
    if (!probed) add('I18_UNFLAGGED_SHARED_EMAIL', `${email} spans ${owners.join(', ')} without a probe marker`);
  }

  /* I19 — a suspended tenant still has valid credentials, so login gating has a subject */
  for (const tenant of graph.tenants.filter((x) => x.status === 'suspended')) {
    const g = graph.by_tenant.find((x) => x.tenant.id === tenant.id);
    if (g && !g.users.some((u) => u.status === 'active' && u.password_hash)) {
      add('I19_SUSPENDED_NO_USERS', `${tenant.id} is suspended with no otherwise-valid login to refuse`);
    }
  }

  /* I20 — platform users exist and are MFA-protected */
  if (graph.platform_users.length === 0) add('I20_NO_PLATFORM_USERS', 'no platform users');
  for (const p of graph.platform_users) {
    if (!p.mfa_enabled) add('I20_PLATFORM_NO_MFA', `${p.id} can reach tenant data without MFA`);
  }
  for (const grant of graph.impersonation_grants) {
    if (!graph.platform_users.some((p) => p.id === grant.platform_user)) {
      add('I20_GRANT_NO_USER', `impersonation grant ${grant.id} names unknown platform user ${grant.platform_user}`);
    }
  }

  /* I15 — at least three tenants, or the isolation suite is weaker than it looks */
  if (graph.by_tenant.length < 3) {
    add('I15_TOO_FEW_TENANTS', `${graph.by_tenant.length} tenants; NFR-QA-020 needs at least 3 to distinguish "leaks to any tenant" from "leaks to the next one"`);
  }

  return v;
}

export function assertValid(graph: SeedGraph, cfg: SeedConfig): void {
  const violations = check(graph, cfg);
  if (violations.length === 0) return;
  const grouped = new Map<string, string[]>();
  for (const x of violations) {
    if (!grouped.has(x.code)) grouped.set(x.code, []);
    grouped.get(x.code)!.push(x.detail);
  }
  const lines: string[] = [`Seed invariants failed: ${violations.length} violation(s).`];
  for (const [code, details] of grouped) {
    lines.push(`  ${code} (${details.length})`);
    for (const d of details.slice(0, 5)) lines.push(`    - ${d}`);
    if (details.length > 5) lines.push(`    ... and ${details.length - 5} more`);
  }
  throw new Error(lines.join('\n'));
}
