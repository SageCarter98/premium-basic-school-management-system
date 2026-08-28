import { build } from './build.js';
import { DEFAULT_CONFIG, PROFILES, type Profile, type SeedConfig } from './config.js';
import { balanceOf } from './generators/finance.js';
import type { SeedGraph } from './types.js';

/**
 * Prints where each deliberate edge case actually lives in the generated graph.
 *
 * The point is falsifiability. It is easy to write a generator that claims to
 * produce a reversed payment and quietly stops producing one after a refactor.
 * This report names the row, so a reviewer can open the fixture and look.
 */

interface Finding {
  label: string;
  requirement: string;
  found: string[];
}

function report(graph: SeedGraph): Finding[] {
  const out: Finding[] = [];
  const push = (label: string, requirement: string, found: string[]) => out.push({ label, requirement, found });

  const hits = (fn: (g: SeedGraph['by_tenant'][number]) => string[]) =>
    graph.by_tenant.flatMap((g) => fn(g).map((x) => `${g.tenant.slug}: ${x}`));

  push('Student with two guardians', 'FR-STU-020 (unresolved)', hits((g) => {
    const counts = new Map<string, string[]>();
    for (const l of g.guardian_links) {
      const list = counts.get(l.student_id) ?? [];
      list.push(l.guardian_id);
      counts.set(l.student_id, list);
    }
    return [...counts.entries()]
      .filter(([, ids]) => ids.length > 1)
      .slice(0, 2)
      .map(([sid, ids]) => `student ${sid} -> ${ids.join(', ')}`);
  }));

  push('Guardian with three or more children', 'FR-STU-020', hits((g) => {
    const counts = new Map<string, number>();
    for (const l of g.guardian_links) counts.set(l.guardian_id, (counts.get(l.guardian_id) ?? 0) + 1);
    return [...counts.entries()].filter(([, n]) => n >= 3).slice(0, 2).map(([gid, n]) => `guardian ${gid} has ${n} children`);
  }));

  push('Attendance conflict, two users, unresolved', 'FR-ATT-011', hits((g) =>
    g.attendance_conflicts.slice(0, 2).map((c) => `${c.id} on ${c.on_date}, state=${c.state}`)));

  push('Attendance correction retaining the original', 'FR-ATT-030', hits((g) =>
    g.attendance_records.filter((a) => a.corrects_record_id).slice(0, 2)
      .map((a) => `${a.id} corrects ${a.corrects_record_id}`)));

  push('Unsynced offline capture', 'FR-UX-020, FR-UX-030', hits((g) => {
    const att = g.attendance_records.filter((a) => a.captured_offline && a.synced_at === null).length;
    const sc = g.scores.filter((s) => s.captured_offline && s.synced_at === null).length;
    return [`${att} attendance rows, ${sc} score rows pending in the queue`];
  }));

  push('Assessment weights that do not total 100', 'FR-ASM-010', hits((g) => {
    const bySchool = new Map<string, number>();
    for (const c of g.assessment_components) bySchool.set(c.school_id, (bySchool.get(c.school_id) ?? 0) + c.weight_percent);
    return [...bySchool.entries()].filter(([, t]) => t !== 100).map(([s, t]) => `school ${s} totals ${t}%`);
  }));

  push('Publication blocked with stated reasons', 'FR-RES-020', hits((g) =>
    g.result_sets.filter((r) => r.blocking_reasons.length > 0).slice(0, 2)
      .map((r) => `${r.id}: ${r.blocking_reasons.join(' | ')}`)));

  push('Published result revised, both versions retained', 'FR-RES-030', hits((g) =>
    g.result_versions.filter((v) => v.supersedes_version_id).slice(0, 2)
      .map((v) => `${v.id} supersedes ${v.supersedes_version_id} — "${v.reopen_reason}"`)));

  push('Reversal with four-eyes approval', 'FR-FIN-020', hits((g) =>
    g.payments.filter((p) => p.reverses_payment_id).slice(0, 2)
      .map((p) => `${p.id} reverses ${p.reverses_payment_id}, requested ${p.reversal_requested_by}, approved ${p.reversal_approved_by}`)));

  push('Unallocated credit on an account', 'Ch 24.1, §8.5', hits((g) =>
    g.payments.filter((p) => p.amount > 0 && p.state === 'confirmed' && !g.allocations.some((a) => a.payment_id === p.id))
      .slice(0, 2)
      .map((p) => `${p.id} GH¢${(p.amount / 100).toFixed(2)} unallocated (student balance GH¢${(balanceOf(g, p.student_id) / 100).toFixed(2)})`)));

  push('Settlement short by exactly the provider fee', 'FR-FIN-030', hits((g) =>
    g.provider_settlements.slice(0, 1).map((s) =>
      `${s.id} gross ${s.gross_amount} fee ${s.fee_amount} net ${s.net_amount} — not a discrepancy`)));

  push('Unmatched and disputed settlement lines', 'FR-FIN-030', hits((g) => {
    const by = new Map<string, number>();
    for (const l of g.settlement_lines) by.set(l.match_state, (by.get(l.match_state) ?? 0) + 1);
    return [[...by.entries()].map(([k, n]) => `${k}=${n}`).join(', ')];
  }));

  push('Mid-term joiner billed pro rata', 'FR-FEE-030', hits((g) =>
    g.invoice_lines.filter((l) => l.prorated_from).slice(0, 2)
      .map((l) => `${l.id}: ${l.description}`)));

  push('Campus transfer inside one academic year', 'FR-STU-030, TEN-013', hits((g) => {
    const byStudentYear = new Map<string, Set<string>>();
    for (const e of g.enrolments) {
      const k = `${e.student_id}|${e.academic_year_id}`;
      const set = byStudentYear.get(k) ?? new Set<string>();
      set.add(e.campus_id);
      byStudentYear.set(k, set);
    }
    return [...byStudentYear.entries()].filter(([, s]) => s.size > 1).slice(0, 2)
      .map(([k, s]) => `${k.split('|')[0]} across ${s.size} campuses`);
  }));

  push('Transferred-out student with debt', 'Ch 24.1', hits((g) =>
    g.students.filter((s) => s.status === 'transferred_out').slice(0, 2)
      .map((s) => `${s.id} balance GH¢${(balanceOf(g, s.id) / 100).toFixed(2)}`)));

  push('Withdrawn consent suppressing a send', 'DP-070', hits((g) =>
    g.message_deliveries.filter((d) => d.state === 'suppressed_no_consent').slice(0, 2)
      .map((d) => `${d.id} to guardian ${d.guardian_id}`)));

  push('Data subject request near the 30-day SLA', 'DP-030, DP-090', hits((g) =>
    g.data_subject_requests.slice(0, 2).map((r) => `${r.id} ${r.kind}, received ${r.received_on}, due ${r.due_on}, ${r.state}`)));

  push('Restricted health record', 'FR-OPS-030, §10', hits((g) =>
    g.health_records.slice(0, 1).map((h) => `${h.id} on student ${h.student_id}, visible to ${h.access_role} only`)));

  push('Platform action in the tenant-visible audit log', 'TEN-022', hits((g) =>
    g.audit_events.filter((a) => a.actor_kind === 'platform').slice(0, 2)
      .map((a) => `${a.action} — ${a.detail}`)));

  push('Suspended tenant with a cause', 'Ch 4.1, FR-BIL-040', graph.tenants
    .filter((t) => t.status === 'suspended')
    .map((t) => `${t.slug}: ${t.suspension_reason} (${graph.platform_invoices.filter((i) => i.tenant_id === t.id && i.status === 'overdue').length} overdue platform invoices)`));

  push('Live impersonation grant', 'TEN-021', graph.impersonation_grants
    .filter((x) => x.ended_at === null)
    .map((x) => `${x.id} ticket ${x.ticket_ref}, expires ${x.expires_at}`));


  push('Every staff member has a login', 'gap closed in v1.1', hits((g) => {
    const missing = g.staff.filter((s) => !g.users.some((u) => u.subject_kind === 'staff' && u.subject_id === s.id)).length;
    return [`${g.staff.length} staff, ${g.users.filter((u) => u.subject_kind === 'staff').length} accounts, ${missing} missing`];
  }));

  push('Locked account', 'Ch 13', hits((g) =>
    g.users.filter((u) => u.probe === 'locked_account').map((u) => `${u.login_email} locked until ${u.locked_until}`)));

  push('Invited but never activated', 'Ch 13', hits((g) =>
    g.invitations.map((i) => `${i.email} token expires ${i.expires_at.slice(0, 10)}, accepted=${i.accepted_at ?? 'no'}`)));

  push('Disabled account, history retained', 'Ch 13', hits((g) =>
    g.users.filter((u) => u.probe === 'departed_staff').map((u) => {
      const scores = g.scores.filter((sc) => sc.entered_by === u.subject_id).length;
      return `${u.login_email} disabled, still credited with ${scores} score entries`;
    })));

  push('Conflict of interest: accountant + headmaster', 'Ch 13, FR-FIN-020', hits((g) =>
    g.users.filter((u) => u.probe === 'conflict_of_interest').map((u) =>
      `${u.login_email} holds ${g.user_roles.filter((r) => r.user_id === u.id).map((r) => r.role).join(' + ')}`)));

  push('Password reset tokens: live, expired, consumed', 'Ch 13', hits((g) => {
    const now = `${graph.meta.as_of}T00:00:00.000Z`;
    const live = g.password_reset_tokens.filter((r) => !r.used_at && r.expires_at > now).length;
    const exp = g.password_reset_tokens.filter((r) => !r.used_at && r.expires_at <= now).length;
    const used = g.password_reset_tokens.filter((r) => r.used_at).length;
    return [`live=${live}, expired=${exp}, consumed=${used}`];
  }));

  push('Parent access links: live, expired, consumed', '§6.3, §8.6', hits((g) => {
    const now = `${graph.meta.as_of}T00:00:00.000Z`;
    const live = g.access_links.filter((l) => !l.used_at && l.expires_at > now).length;
    const exp = g.access_links.filter((l) => !l.used_at && l.expires_at <= now).length;
    const used = g.access_links.filter((l) => l.used_at).length;
    return [`live=${live}, expired=${exp}, consumed=${used}`];
  }));

  push('MFA on money roles, not on teachers', 'Ch 13', hits((g) => {
    const on = g.users.filter((u) => u.mfa_enabled).length;
    const teachers = g.users.filter((u) => g.user_roles.some((r) => r.user_id === u.id && r.role === 'teacher'));
    const teachersWithMfa = teachers.filter((u) => u.mfa_enabled).length;
    return [`${on} accounts with MFA; ${teachersWithMfa} of ${teachers.length} teachers`];
  }));

  push('Teacher role scoped to specific classes', 'Ch 13, §10', hits((g) => {
    const r = g.user_roles.filter((x) => x.role === 'teacher');
    const scoped = r.filter((x) => x.scope_kind === 'class' && x.scope_id).length;
    return [`${scoped} of ${r.length} teacher role rows are class-scoped`];
  }));

  push('Guardians authenticate without a password', '§6.3', hits((g) => {
    const otp = g.users.filter((u) => u.subject_kind === 'guardian' && u.auth_method === 'otp').length;
    const withHash = g.users.filter((u) => u.subject_kind === 'guardian' && u.password_hash).length;
    return [`${otp} OTP guardians, ${withHash} carrying a password hash`];
  }));

  push('Student logins limited to JHS', 'FR-RES-040', hits((g) => {
    const stu = g.users.filter((u) => u.subject_kind === 'student').length;
    return [`${stu} student accounts out of ${g.students.length} students`];
  }));

  push('One email reused across two tenants', 'TEN-012 (uniqueness scope)', (() => {
    const owners = new Map<string, string[]>();
    for (const g of graph.by_tenant) {
      for (const u of g.users) {
        if (!u.login_email) continue;
        const k = u.login_email.toLowerCase();
        const list = owners.get(k) ?? [];
        if (!list.includes(g.tenant.slug)) list.push(g.tenant.slug);
        owners.set(k, list);
      }
    }
    return [...owners.entries()].filter(([, o]) => o.length > 1).map(([e, o]) => `${e} in ${o.join(' and ')}`);
  })());

  push('Valid credentials inside a suspended tenant', 'Ch 4.1', graph.by_tenant
    .filter((g) => g.tenant.status === 'suspended')
    .map((g) => `${g.tenant.slug}: ${g.users.filter((u) => u.status === 'active' && u.password_hash).length} active password accounts that login must still refuse`));

  push('Platform users, all MFA-protected', 'TEN-021', [
    `${graph.platform_users.length} platform accounts, ${graph.platform_users.filter((p) => p.mfa_enabled).length} with MFA`,
  ]);

  return out;
}

function main(): void {
  const cfg: SeedConfig = { ...DEFAULT_CONFIG };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split('=');
    const value = inline ?? argv[i + 1];
    if (flag === '--profile' && value in PROFILES) cfg.profile = value as Profile;
    if (flag === '--seed') cfg.seed = value;
    if (flag === '--cardinality' && (value === 'many_to_many' || value === 'one_to_many')) cfg.guardianCardinality = value;
  }

  const graph = build(cfg);
  const findings = report(graph);

  console.log(`Edge-case inventory — seed=${cfg.seed} profile=${cfg.profile} cardinality=${cfg.guardianCardinality}\n`);
  let missing = 0;
  for (const f of findings) {
    const mark = f.found.length > 0 ? 'ok  ' : 'MISS';
    if (f.found.length === 0) missing++;
    console.log(`${mark} ${f.label}  [${f.requirement}]`);
    for (const line of f.found) console.log(`       ${line}`);
  }
  console.log(`\n${findings.length - missing}/${findings.length} present`);
  if (missing > 0) process.exit(1);
}

main();
