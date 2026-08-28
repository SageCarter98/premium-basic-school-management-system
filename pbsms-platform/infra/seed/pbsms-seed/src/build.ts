import { PLANS, type SeedConfig } from './config.js';
import { generateAcademic } from './generators/academic.js';
import { generateActivity } from './generators/activity.js';
import { generateCompliance } from './generators/compliance.js';
import { generateFinance } from './generators/finance.js';
import { generateIdentity } from './generators/identity.js';
import { generatePeople } from './generators/people.js';
import { FIXTURE_PASSWORDS } from './generators/identity.js';
import { hashPassword, resetHashCache, totpSecret } from './credentials.js';
import { addDays, at, nextId, resetIds, Rng } from './rng.js';
import type { PlatformUser, SeedGraph, Tenant, TenantGraph } from './types.js';

export const GENERATOR_VERSION = '1.0.0';

function emptyTenantGraph(tenant: Tenant): TenantGraph {
  return {
    tenant,
    schools: [], campuses: [], academic_years: [], terms: [], divisions: [], class_levels: [],
    classes: [], subjects: [], teaching_assignments: [], staff: [], students: [], enrolments: [],
    guardians: [], guardian_links: [], users: [], user_roles: [], invitations: [],
    password_reset_tokens: [], access_links: [], attendance_records: [], attendance_conflicts: [],
    assessment_components: [], assessment_instances: [], scores: [], grading_scales: [],
    grade_bands: [], result_sets: [], result_versions: [], result_lines: [], fee_structures: [],
    fee_items: [], invoices: [], invoice_lines: [], payments: [], allocations: [],
    financial_assistance: [], provider_settlements: [], settlement_lines: [], message_templates: [],
    message_batches: [], message_deliveries: [], consent_records: [], health_records: [],
    discipline_cases: [], data_subject_requests: [], audit_events: [],
  };
}

export function build(cfg: SeedConfig): SeedGraph {
  resetIds();
  resetHashCache();
  const rng = new Rng(cfg.seed);

  const graph: SeedGraph = {
    meta: {
      seed: cfg.seed,
      // Deterministic: never Date.now(). A timestamp here would make every run
      // differ and defeat the whole point of a reproducible fixture.
      generated_at: at(cfg.asOf, 6, 0),
      generator_version: GENERATOR_VERSION,
      as_of: cfg.asOf,
      guardian_cardinality: cfg.guardianCardinality,
    },
    plans: PLANS,
    tenants: [],
    platform_users: [],
    metering: [],
    platform_invoices: [],
    impersonation_grants: [],
    by_tenant: [],
  };

  for (const spec of cfg.tenants) {
    const tenant: Tenant = {
      id: `tnt_${spec.slug}`,
      slug: spec.slug,
      legal_name: spec.legal_name,
      display_name: spec.display_name,
      status: spec.status,
      plan_id: PLANS.find((p) => p.code === spec.plan)!.id,
      region: 'Greater Accra',
      created_at: at('2024-06-14', 9, 0),
      suspended_at: spec.status === 'suspended' ? at(addDays(cfg.asOf, -48), 16, 30) : null,
      suspension_reason: spec.status === 'suspended' ? 'Platform invoice unpaid for 62 days' : null,
    };
    graph.tenants.push(tenant);

    const g = emptyTenantGraph(tenant);
    const tenantRng = rng.stream(spec.slug);

    generateAcademic(g, spec, cfg, tenantRng);
    generatePeople(g, spec, cfg, tenantRng);
    generateIdentity(g, spec, cfg, tenantRng);
    generateActivity(g, spec, cfg, tenantRng);
    generateFinance(g, spec, cfg, tenantRng);
    generateCompliance(g, spec, cfg, tenantRng);

    graph.by_tenant.push(g);
  }


  /* ------------------------------------------------------ platform users */
  // Above the tenant boundary: no tenant_id, and MFA is not optional for
  // anyone who can reach a customer's data through impersonation.
  const pfmPw = hashPassword(FIXTURE_PASSWORDS.platform, cfg.hashMode, cfg.seed);
  const pfmSpecs: { id: string; email: string; display_name: string; role: PlatformUser['role'] }[] = [
    { id: 'pfm_support_01', email: 'support1@pbsms.gh', display_name: 'Akosua Danso', role: 'support' },
    { id: 'pfm_support_02', email: 'support2@pbsms.gh', display_name: 'Kwabena Osei', role: 'support' },
    { id: 'pfm_billing_01', email: 'billing@pbsms.gh', display_name: 'Efua Arthur', role: 'billing' },
    { id: 'pfm_admin_01', email: 'admin@pbsms.gh', display_name: 'Selorm Agbeko', role: 'platform_admin' },
  ];
  for (const p of pfmSpecs) {
    graph.platform_users.push({
      id: p.id,
      email: p.email,
      display_name: p.display_name,
      role: p.role,
      password_algo: pfmPw.algo,
      password_hash: pfmPw.hash,
      mfa_enabled: true,
      mfa_secret: totpSecret(cfg.seed, p.id),
      status: 'active',
      created_at: at('2024-05-02', 8, 0),
    });
  }

  /* ----------------------------------------------- platform-side billing */
  // Metering is per active student per period (the confirmed model), so it must
  // be derived from enrolment, not from a stored counter that can drift.
  const periods = ['2025-11', '2025-12', '2026-01', '2026-02'];
  for (const g of graph.by_tenant) {
    const plan = graph.plans.find((p) => p.id === g.tenant.plan_id)!;
    for (const period of periods) {
      const monthEnd = `${period}-28`;
      const active = g.students.filter((s) => {
        const enr = g.enrolments.filter((e) => e.student_id === s.id);
        return enr.some((e) => e.started_on <= monthEnd && (e.ended_on === null || e.ended_on >= monthEnd));
      }).length;
      const billable = Math.max(active, plan.min_billable_students);
      graph.metering.push({
        id: nextId('mtr'),
        tenant_id: g.tenant.id,
        period,
        active_students: active,
        billable_students: billable,
        captured_at: at(`${period}-28`, 23, 55),
      });

      const amount = billable * plan.price_per_active_student;
      const issuedOn = `${period}-28`;
      const dueOn = addDays(issuedOn, 14);
      const overdue = g.tenant.status === 'suspended' && period <= '2025-12';
      graph.platform_invoices.push({
        id: nextId('pinv'),
        tenant_id: g.tenant.id,
        period,
        active_students: active,
        unit_price: plan.price_per_active_student,
        amount,
        status: overdue ? 'overdue' : dueOn < cfg.asOf ? 'paid' : 'issued',
        issued_on: issuedOn,
        due_on: dueOn,
      });
    }
  }

  /* --------------------------------------------------- impersonation */
  // One expired grant and one live one, so the banner in §8.10 has both states
  // and an expiry check has something to reject.
  const first = graph.tenants[0];
  graph.impersonation_grants.push(
    {
      id: nextId('imp'),
      tenant_id: first.id,
      platform_user: 'pfm_support_01',
      ticket_ref: '#4821',
      granted_at: at(addDays(cfg.asOf, -5), 10, 30),
      expires_at: at(addDays(cfg.asOf, -5), 11, 30),
      read_only: true,
      ended_at: at(addDays(cfg.asOf, -5), 10, 58),
    },
    {
      id: nextId('imp'),
      tenant_id: graph.tenants[graph.tenants.length - 1].id,
      platform_user: 'pfm_support_02',
      ticket_ref: '#5107',
      granted_at: at(cfg.asOf, 8, 15),
      expires_at: at(cfg.asOf, 9, 15),
      read_only: true,
      ended_at: null,
    },
  );

  return graph;
}

export function counts(graph: SeedGraph): Record<string, number> {
  const out: Record<string, number> = {
    plans: graph.plans.length,
    tenants: graph.tenants.length,
    metering: graph.metering.length,
    platform_invoices: graph.platform_invoices.length,
    impersonation_grants: graph.impersonation_grants.length,
    platform_users: graph.platform_users.length,
  };
  for (const g of graph.by_tenant) {
    for (const [k, v] of Object.entries(g)) {
      if (Array.isArray(v)) out[k] = (out[k] ?? 0) + v.length;
    }
  }
  return out;
}
