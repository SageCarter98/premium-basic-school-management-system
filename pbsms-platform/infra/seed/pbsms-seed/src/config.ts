import type { HashMode } from './credentials.js';
import type { ISODate, PlanTier, TenantStatus } from './types.js';

/**
 * Volume profiles.
 *
 *   ci      - smallest graph that still contains every edge case. Must stay
 *             fast enough to run on every pull request, because the
 *             cross-tenant isolation suite (NFR-QA-020) depends on it.
 *   dev     - a plausible working day. What you develop against.
 *   volume  - full-term attendance and score density, for perf work against
 *             NFR-PERF-020 and the report-card batch budget (NFR-PERF-023).
 */
export type Profile = 'ci' | 'dev' | 'volume';

export interface ProfileSettings {
  streamsPerLevel: number;
  studentsPerClass: number;
  /** School days sampled per term for attendance. -1 means every school day. */
  attendanceDaysPerTerm: number;
  /** Levels included, counted from the top of the ladder (JHS 3 downwards). */
  levelsFromTop: number;
  guardiansPerStudentMax: number;
}

export const PROFILES: Record<Profile, ProfileSettings> = {
  ci: { streamsPerLevel: 1, studentsPerClass: 12, attendanceDaysPerTerm: 6, levelsFromTop: 4, guardiansPerStudentMax: 2 },
  dev: { streamsPerLevel: 2, studentsPerClass: 26, attendanceDaysPerTerm: 15, levelsFromTop: 13, guardiansPerStudentMax: 2 },
  volume: { streamsPerLevel: 3, studentsPerClass: 38, attendanceDaysPerTerm: -1, levelsFromTop: 13, guardiansPerStudentMax: 3 },
};

export interface SchoolSpec {
  name: string;
  campuses: string[];
  districtIndex: number;
  ownership: 'private' | 'public';
  locality: 'urban' | 'rural';
}

export interface TenantSpec {
  slug: string;
  legal_name: string;
  display_name: string;
  status: TenantStatus;
  plan: PlanTier;
  schools: SchoolSpec[];
  /** Scale factor applied to the profile's studentsPerClass for this tenant. */
  sizeFactor: number;
}

export interface SeedConfig {
  seed: string;
  /** The moment the fixture represents. Drives which term is active. */
  asOf: ISODate;
  profile: Profile;
  /**
   * The unresolved FR-STU-020 question. In many_to_many the generator emits a
   * student with two guardian links; in one_to_many it does not, and
   * invariants.ts asserts no student has more than one link. Run the suite both
   * ways before amending the SRS — the schema, not this file, should be the one
   * that refuses.
   */
  guardianCardinality: 'many_to_many' | 'one_to_many';
  /**
   * scrypt emits a real (fixture-grade) hash; none emits `plain:<password>` so
   * the application can rehash on load with its own argon2id parameters.
   */
  hashMode: HashMode;
  /** Must match current_setting(...) in the RLS policies. */
  rlsSessionVar: string;
  sqlSchema: string;
  tenants: TenantSpec[];
}

/**
 * Three tenants, deliberately. One is not enough to prove isolation, and two
 * cannot distinguish "leaks to any other tenant" from "leaks to the next tenant
 * in insert order". The suspended one exists because subscription gating is
 * enforced at the API layer and needs a subject.
 */
export const SCENARIO: TenantSpec[] = [
  {
    slug: 'sunrise',
    legal_name: 'Sunrise Educational Complex Ltd',
    display_name: 'Sunrise Basic School',
    status: 'active',
    plan: 'ketewese',
    sizeFactor: 1,
    schools: [
      { name: 'Sunrise Basic School', campuses: ['Main Campus'], districtIndex: 0, ownership: 'private', locality: 'urban' },
    ],
  },
  {
    slug: 'brightfuture',
    legal_name: 'Bright Future Education Group Ltd',
    display_name: 'Bright Future Group',
    status: 'active',
    plan: 'ebom',
    sizeFactor: 1,
    schools: [
      { name: 'Bright Future Academy', campuses: ['Adenta Campus', 'Ashaley Botwe Campus'], districtIndex: 1, ownership: 'private', locality: 'urban' },
      { name: 'Bright Future Preparatory School', campuses: ['Main Campus'], districtIndex: 4, ownership: 'private', locality: 'urban' },
    ],
  },
  {
    slug: 'mountzion',
    legal_name: 'Mount Zion Preparatory School',
    display_name: 'Mount Zion Preparatory',
    status: 'suspended',
    plan: 'ketewese',
    sizeFactor: 0.5,
    schools: [
      { name: 'Mount Zion Preparatory School', campuses: ['Main Campus'], districtIndex: 9, ownership: 'private', locality: 'rural' },
    ],
  },
];

export const DEFAULT_CONFIG: SeedConfig = {
  seed: 'pbsms-2026-baseline',
  // Mid Term 2 of 2025/2026. Chosen so an active term, a closed term and a
  // planned term all exist at once; a fixture generated between academic years
  // silently skips every in-term code path.
  asOf: '2026-02-18',
  profile: 'dev',
  guardianCardinality: 'many_to_many',
  hashMode: 'scrypt',
  // PBSMS integration fix: the real RLS policies (infra/migrations/
  // 0001_init_tenancy.sql) and TenantDatabaseService both read
  // app.current_tenant, not the tool's own default of app.tenant_id. Per
  // this file's own INTEGRATION.md: "Do not change the generators to
  // match the schema; change the mapping" -- this is that mapping.
  rlsSessionVar: 'app.current_tenant',
  sqlSchema: 'public',
  tenants: SCENARIO,
};

/** Academic calendars, keyed by year label. Ghanaian three-term structure. */
export const CALENDARS: Record<string, { starts: ISODate; ends: ISODate; terms: { seq: 1 | 2 | 3; name: string; starts: ISODate; ends: ISODate }[] }> = {
  '2024/2025': {
    starts: '2024-09-10',
    ends: '2025-07-25',
    terms: [
      { seq: 1, name: 'Term 1', starts: '2024-09-10', ends: '2024-12-20' },
      { seq: 2, name: 'Term 2', starts: '2025-01-14', ends: '2025-04-04' },
      { seq: 3, name: 'Term 3', starts: '2025-04-29', ends: '2025-07-25' },
    ],
  },
  '2025/2026': {
    starts: '2025-09-09',
    ends: '2026-07-24',
    terms: [
      { seq: 1, name: 'Term 1', starts: '2025-09-09', ends: '2025-12-19' },
      { seq: 2, name: 'Term 2', starts: '2026-01-13', ends: '2026-04-02' },
      { seq: 3, name: 'Term 3', starts: '2026-04-28', ends: '2026-07-24' },
    ],
  },
};

export const YEAR_LABELS = ['2024/2025', '2025/2026'];

export const PLANS = [
  {
    id: 'plan_ketewese',
    code: 'ketewese' as PlanTier,
    name: 'Ketewese',
    price_per_active_student: 350, // GH¢3.50 per active student per month
    min_billable_students: 50,
    features: ['students', 'attendance', 'assessment', 'results', 'report_cards', 'basic_finance'],
  },
  {
    id: 'plan_ebom',
    code: 'ebom' as PlanTier,
    name: 'Ebom',
    price_per_active_student: 600, // GH¢6.00
    min_billable_students: 100,
    features: [
      'students', 'attendance', 'assessment', 'results', 'report_cards', 'finance',
      'reconciliation', 'communication', 'analytics', 'group_rollup', 'multi_campus',
      'library', 'transport', 'health', 'discipline', 'inventory', 'bece', 'csspd',
    ],
  },
];
