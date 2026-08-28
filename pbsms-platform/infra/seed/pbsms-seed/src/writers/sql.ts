import type { SeedConfig } from '../config.js';
import { TENANT_TABLE_ORDER, type SeedGraph, type TenantGraph } from '../types.js';

/**
 * Emits SQL that inserts each tenant's rows INSIDE that tenant's RLS context,
 * via set_config(<session var>, <tenant id>, true).
 *
 * Run this as a role that does NOT have BYPASSRLS. That is the point: if a
 * policy's WITH CHECK is wrong, or a table was created without RLS enabled and
 * forced, seeding either fails or silently succeeds where it should not — and
 * either outcome is information you want before writing application code, not
 * after.
 *
 * Platform tables (plans, tenants, metering, platform invoices, impersonation
 * grants) sit above the tenant boundary and are written first, outside any
 * tenant context, by the platform role.
 */

/** Graph key -> database table. Change here, not in the generators. */
export const TABLE_NAMES: Record<string, string> = {
  schools: 'schools',
  campuses: 'campuses',
  academic_years: 'academic_years',
  terms: 'terms',
  divisions: 'divisions',
  class_levels: 'class_levels',
  classes: 'classes',
  subjects: 'subjects',
  // PBSMS integration fix: the real migration is infra/migrations/
  // 0020_teacher_assignments.sql, table teacher_assignments.
  teaching_assignments: 'teacher_assignments',
  staff: 'staff',
  students: 'students',
  enrolments: 'enrolments',
  guardians: 'guardians',
  guardian_links: 'guardian_links',
  users: 'users',
  user_roles: 'user_roles',
  invitations: 'invitations',
  password_reset_tokens: 'password_reset_tokens',
  access_links: 'access_links',
  attendance_records: 'attendance_records',
  attendance_conflicts: 'attendance_conflicts',
  assessment_components: 'assessment_components',
  assessment_instances: 'assessment_instances',
  scores: 'scores',
  grading_scales: 'grading_scales',
  grade_bands: 'grade_bands',
  result_sets: 'result_sets',
  result_versions: 'result_versions',
  result_lines: 'result_lines',
  fee_structures: 'fee_structures',
  fee_items: 'fee_items',
  invoices: 'invoices',
  invoice_lines: 'invoice_lines',
  payments: 'payments',
  allocations: 'allocations',
  financial_assistance: 'financial_assistance',
  provider_settlements: 'provider_settlements',
  settlement_lines: 'settlement_lines',
  message_templates: 'message_templates',
  message_batches: 'message_batches',
  message_deliveries: 'message_deliveries',
  consent_records: 'consent_records',
  health_records: 'health_records',
  discipline_cases: 'discipline_cases',
  data_subject_requests: 'data_subject_requests',
  audit_events: 'audit_events',
  plans: 'plans',
  tenants: 'tenants',
  platform_users: 'platform_users',
  metering: 'metering_snapshots',
  platform_invoices: 'platform_invoices',
  impersonation_grants: 'impersonation_grants',
};

function lit(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number in fixture: ${value}`);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (Array.isArray(value)) {
    if (value.length === 0) return `'{}'::text[]`;
    return `ARRAY[${value.map((x) => lit(x)).join(', ')}]::text[]`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function* insertBlock(table: string, rows: Record<string, unknown>[], schema: string): Generator<string> {
  if (rows.length === 0) {
    yield `-- ${table}: no rows\n`;
    return;
  }
  const cols = Object.keys(rows[0]);
  // Chunked so a failure points at a small batch rather than one giant
  // statement, and so the volume profile never materialises a single string
  // larger than V8 will hold.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map((r) => `  (${cols.map((c) => lit(r[c])).join(', ')})`).join(',\n');
    yield `INSERT INTO ${schema}.${table} (${cols.join(', ')}) VALUES\n${values};\n\n`;
  }
}

export function* sqlChunks(graph: SeedGraph, cfg: SeedConfig): Generator<string> {
  const s = cfg.sqlSchema;

  yield `-- PBSMS seed fixture\n`;
  yield `-- seed=${graph.meta.seed} profile=${cfg.profile} as_of=${graph.meta.as_of}\n`;
  yield `-- guardian_cardinality=${graph.meta.guardian_cardinality}\n`;
  yield `-- generator=${graph.meta.generator_version}\n`;
  yield `--\n`;
  yield `-- Run as a NON-BYPASSRLS role. Seeding through the policies is\n`;
  yield `-- half the value of this file.\n\n`;
  yield `BEGIN;\n\n`;

  yield `-- ============ platform scope (no tenant context) ============\n`;
  yield* insertBlock(TABLE_NAMES.plans, graph.plans as unknown as Record<string, unknown>[], s);
  yield* insertBlock(TABLE_NAMES.tenants, graph.tenants as unknown as Record<string, unknown>[], s);
  yield* insertBlock(TABLE_NAMES.platform_users, graph.platform_users as unknown as Record<string, unknown>[], s);
  yield* insertBlock(TABLE_NAMES.metering, graph.metering as unknown as Record<string, unknown>[], s);
  yield* insertBlock(TABLE_NAMES.platform_invoices, graph.platform_invoices as unknown as Record<string, unknown>[], s);
  yield* insertBlock(TABLE_NAMES.impersonation_grants, graph.impersonation_grants as unknown as Record<string, unknown>[], s);

  for (const g of graph.by_tenant) {
    yield `\n-- ============ tenant: ${g.tenant.slug} (${g.tenant.id}) ============\n`;
    yield `SELECT set_config('${cfg.rlsSessionVar}', '${g.tenant.id}', true);\n\n`;
    for (const key of TENANT_TABLE_ORDER) {
      const rows = g[key] as unknown as Record<string, unknown>[];
      yield* insertBlock(TABLE_NAMES[key] ?? key, rows, s);
    }
    yield `SELECT set_config('${cfg.rlsSessionVar}', '', true);\n`;
  }

  yield `\nCOMMIT;\n`;
}

/** Only safe for ci/dev-sized graphs; use sqlChunks with a stream at volume. */
export function toSql(graph: SeedGraph, cfg: SeedConfig): string {
  return [...sqlChunks(graph, cfg)].join('');
}

/**
 * A standalone assertion script. Run it after loading the fixture, as an
 * ordinary tenant role, to confirm the policies actually bite. Every SELECT
 * below must return zero rows; if any returns more, RLS is not doing its job
 * and no amount of application-layer scoping will save you.
 */
export function isolationProbeSql(graph: SeedGraph, cfg: SeedConfig): string {
  const s = cfg.sqlSchema;
  const [a, b] = graph.tenants;
  const lines: string[] = [
    `-- NFR-QA-020 probe. Every query must return 0.`,
    `-- Run as an ordinary application role, never as superuser or BYPASSRLS.`,
    ``,
    `SELECT set_config('${cfg.rlsSessionVar}', '${a.id}', false);`,
    ``,
  ];

  const probes: [string, string][] = [
    ['students', `tenant_id <> '${a.id}'`],
    ['guardians', `tenant_id <> '${a.id}'`],
    ['payments', `tenant_id <> '${a.id}'`],
    ['result_lines', `tenant_id <> '${a.id}'`],
    ['health_records', `tenant_id <> '${a.id}'`],
    ['audit_events', `tenant_id <> '${a.id}'`],
    ['users', `tenant_id <> '${a.id}'`],
    ['access_links', `tenant_id <> '${a.id}'`],
    ['password_reset_tokens', `tenant_id <> '${a.id}'`],
  ];
  for (const [table, pred] of probes) {
    lines.push(`SELECT '${table}' AS probe, count(*) AS leaked FROM ${s}.${TABLE_NAMES[table] ?? table} WHERE ${pred};`);
  }

  lines.push(
    ``,
    `-- Write-side: inserting another tenant's row must be rejected by WITH CHECK,`,
    `-- not merely filtered out on read.`,
    `DO $$`,
    `BEGIN`,
    `  INSERT INTO ${s}.${TABLE_NAMES.students} (tenant_id, id, school_id, admission_no, first_name, middle_name, last_name, sex, date_of_birth, admitted_on, status, has_restricted_health_record)`,
    `  VALUES ('${b.id}', 'stu_probe_9999', NULL, 'PROBE/0000', 'Probe', NULL, 'Row', 'F', '2015-01-01', '2025-09-09', 'active', false);`,
    `  RAISE EXCEPTION 'RLS FAILURE: cross-tenant INSERT succeeded';`,
    `EXCEPTION`,
    `  WHEN insufficient_privilege OR check_violation THEN`,
    `    RAISE NOTICE 'ok: cross-tenant INSERT rejected';`,
    `END $$;`,
  );
  return lines.join('\n');
}

export type { TenantGraph };
