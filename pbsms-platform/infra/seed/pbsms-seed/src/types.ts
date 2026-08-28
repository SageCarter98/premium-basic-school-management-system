/**
 * PBSMS seed fixture graph.
 *
 * Two classes of row exist and they are NOT interchangeable:
 *
 *   PlatformRow  - lives above the tenant boundary (plans, tenants, platform
 *                  invoices, platform audit). No tenant_id. Written by the
 *                  platform role only.
 *   TenantRow    - every other row. tenant_id is mandatory and is the column
 *                  every RLS policy keys on. A TenantRow without tenant_id is
 *                  a bug, and invariants.ts fails the build on it.
 *
 * Field sets are deliberately lean: this is a seed contract, not the schema.
 * Map these onto the real columns in writers/sql.ts (or writers/api.ts) rather
 * than widening this file.
 */

export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // full ISO 8601
export type Pesewas = number; // GHS minor units. Never floats for money.

export interface TenantRow {
  tenant_id: string;
}

/* ---------------------------------------------------------------- platform */

export type PlanTier = 'ketewese' | 'ebom';

export interface Plan {
  id: string;
  code: PlanTier;
  name: string;
  price_per_active_student: Pesewas;
  min_billable_students: number;
  features: string[];
}

export type TenantStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'offboarded';

export interface Tenant {
  id: string;
  slug: string;
  legal_name: string;
  display_name: string;
  status: TenantStatus;
  plan_id: string;
  region: string;
  created_at: ISODateTime;
  suspended_at: ISODateTime | null;
  suspension_reason: string | null;
}

export interface MeteringSnapshot {
  id: string;
  tenant_id: string; // platform-side reference, not an RLS-scoped row
  period: string; // YYYY-MM
  active_students: number;
  billable_students: number;
  captured_at: ISODateTime;
}

export interface PlatformInvoice {
  id: string;
  tenant_id: string;
  period: string;
  active_students: number;
  unit_price: Pesewas;
  amount: Pesewas;
  status: 'draft' | 'issued' | 'paid' | 'overdue' | 'written_off';
  issued_on: ISODate;
  due_on: ISODate;
}

export interface ImpersonationGrant {
  id: string;
  tenant_id: string;
  platform_user: string;
  ticket_ref: string;
  granted_at: ISODateTime;
  expires_at: ISODateTime;
  read_only: boolean;
  ended_at: ISODateTime | null;
}


/* ---------------------------------------------------------------- identity */

export type AuthMethod = 'password' | 'otp' | 'link_only';
export type UserStatus = 'active' | 'invited' | 'locked' | 'disabled';
export type SubjectKind = 'staff' | 'guardian' | 'student';
export type RoleScope = 'tenant' | 'school' | 'campus' | 'class';

/**
 * A login identity, deliberately SEPARATE from the person record.
 *
 * Staff, guardians and students are domain entities; a user is a credential
 * attached to one of them. Collapsing the two means a guardian cannot exist
 * before they activate an account, a departed teacher cannot be disabled
 * without deleting their marking history, and a person can never hold two
 * identities. All three come up in a real school inside the first term.
 */
export interface User extends TenantRow {
  id: string;
  subject_kind: SubjectKind;
  subject_id: string;
  login_email: string | null;
  login_phone: string | null;
  auth_method: AuthMethod;
  password_algo: string | null;
  password_hash: string | null;
  must_change_password: boolean;
  mfa_enabled: boolean;
  /** Fixture only. Base32 TOTP secret so tests can compute a valid code. */
  mfa_secret: string | null;
  status: UserStatus;
  failed_login_count: number;
  locked_until: ISODateTime | null;
  last_login_at: ISODateTime | null;
  created_at: ISODateTime;
  probe: string | null;
}

export interface UserRole extends TenantRow {
  id: string;
  user_id: string;
  role: StaffRole | 'guardian' | 'student';
  scope_kind: RoleScope;
  /** NULL means tenant-wide. Otherwise a school, campus or class id. */
  scope_id: string | null;
}

export interface Invitation extends TenantRow {
  id: string;
  user_id: string;
  email: string;
  token: string;
  invited_by: string;
  invited_at: ISODateTime;
  expires_at: ISODateTime;
  accepted_at: ISODateTime | null;
}

export interface PasswordResetToken extends TenantRow {
  id: string;
  user_id: string;
  token: string;
  requested_at: ISODateTime;
  expires_at: ISODateTime;
  used_at: ISODateTime | null;
}

/**
 * The Parent View arrives from a WhatsApp link (frontend spec §6.3, §8.6).
 * That link is the credential, so it is a first-class row with an expiry and a
 * single-use flag, not a query string appended to a URL.
 */
export interface AccessLink extends TenantRow {
  id: string;
  guardian_id: string;
  student_id: string;
  purpose: 'report_card' | 'invoice' | 'statement';
  token: string;
  channel: 'sms' | 'whatsapp' | 'email';
  issued_at: ISODateTime;
  expires_at: ISODateTime;
  used_at: ISODateTime | null;
}

/** Platform staff. No tenant_id — these sit above the boundary. */
export interface PlatformUser {
  id: string;
  email: string;
  display_name: string;
  role: 'support' | 'billing' | 'platform_admin';
  password_algo: string;
  password_hash: string;
  mfa_enabled: boolean;
  mfa_secret: string | null;
  status: UserStatus;
  created_at: ISODateTime;
}

/* ------------------------------------------------------------ org / academic */

export interface School extends TenantRow {
  id: string;
  name: string;
  code: string;
  district: string;
  ownership: 'private' | 'public';
  locality: 'urban' | 'rural';
}

export interface Campus extends TenantRow {
  id: string;
  school_id: string;
  name: string;
  is_primary: boolean;
}

export type YearState = 'planned' | 'active' | 'closed';

export interface AcademicYear extends TenantRow {
  id: string;
  school_id: string;
  label: string; // 2025/2026
  starts_on: ISODate;
  ends_on: ISODate;
  state: YearState;
}

export type TermState = 'planned' | 'active' | 'closed';

export interface Term extends TenantRow {
  id: string;
  academic_year_id: string;
  sequence: 1 | 2 | 3;
  name: string;
  starts_on: ISODate;
  ends_on: ISODate;
  state: TermState;
  score_entry_opens_on: ISODate;
  score_entry_closes_on: ISODate;
}

export interface Division extends TenantRow {
  id: string;
  school_id: string;
  name: 'Nursery' | 'Kindergarten' | 'Primary' | 'Junior High School';
  sequence: number;
}

export interface ClassLevel extends TenantRow {
  id: string;
  division_id: string;
  name: string; // 'JHS 2'
  sequence: number; // global ordering across the whole basic ladder
}

export interface SchoolClass extends TenantRow {
  id: string;
  campus_id: string;
  class_level_id: string;
  academic_year_id: string;
  name: string; // 'JHS 2A'
  stream: string; // 'A'
  class_teacher_id: string | null;
  capacity: number;
}

export interface Subject extends TenantRow {
  id: string;
  school_id: string;
  name: string;
  code: string;
  division_ids: string[];
  is_core: boolean;
  nacca_strand_count: number;
}

export interface TeachingAssignment extends TenantRow {
  id: string;
  staff_id: string;
  class_id: string;
  subject_id: string;
  academic_year_id: string;
}

/* ---------------------------------------------------------------- people */

export type StaffRole =
  | 'proprietor'
  | 'headmaster'
  | 'accountant'
  | 'academic_coordinator'
  | 'admissions_officer'
  | 'health_officer'
  | 'teacher';

export interface Staff extends TenantRow {
  id: string;
  school_id: string;
  staff_no: string;
  first_name: string;
  last_name: string;
  roles: StaffRole[];
  email: string;
  phone: string;
  is_active: boolean;
}

export type StudentStatus = 'active' | 'transferred_out' | 'withdrawn' | 'graduated';

export interface Student extends TenantRow {
  id: string;
  school_id: string;
  admission_no: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  sex: 'M' | 'F';
  date_of_birth: ISODate;
  admitted_on: ISODate;
  status: StudentStatus;
  has_restricted_health_record: boolean;
}

export interface Enrolment extends TenantRow {
  id: string;
  student_id: string;
  class_id: string;
  academic_year_id: string;
  campus_id: string;
  started_on: ISODate;
  ended_on: ISODate | null;
  end_reason: 'transfer_in_class' | 'transfer_campus' | 'transfer_out' | 'promotion' | null;
  is_current: boolean;
}

export type GuardianRelationship = 'mother' | 'father' | 'grandparent' | 'aunt' | 'uncle' | 'guardian';

export interface Guardian extends TenantRow {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  alt_phone: string | null;
  email: string | null;
  occupation: string;
  national_id_last4: string;
}

export interface GuardianLink extends TenantRow {
  id: string;
  guardian_id: string;
  student_id: string;
  relationship: GuardianRelationship;
  is_primary: boolean;
  is_fee_payer: boolean;
  receives_communication: boolean;
  /** Set only on the deliberate cardinality probe. See edge-cases in build.ts. */
  probe: 'guardian_cardinality' | null;
}

/* ------------------------------------------------------------- attendance */

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused' | 'sick';

export interface AttendanceRecord extends TenantRow {
  id: string;
  student_id: string;
  class_id: string;
  term_id: string;
  on_date: ISODate;
  status: AttendanceStatus;
  reason: string | null;
  marked_by: string; // staff id
  marked_at: ISODateTime;
  device_id: string;
  captured_offline: boolean;
  synced_at: ISODateTime | null;
  /** Original value retained when a correction is applied (FR-ATT-030). */
  corrects_record_id: string | null;
  correction_reason: string | null;
}

export interface AttendanceConflict extends TenantRow {
  id: string;
  student_id: string;
  on_date: ISODate;
  record_a_id: string;
  record_b_id: string;
  state: 'open' | 'resolved';
  resolved_record_id: string | null;
  resolved_by: string | null;
}

/* ------------------------------------------------- assessment and results */

export interface AssessmentComponent extends TenantRow {
  id: string;
  school_id: string;
  academic_year_id: string;
  name: string; // 'Class Score', 'Mid-term', 'End of Term'
  weight_percent: number;
  max_score: number;
  sequence: number;
  /** Marks the deliberately-broken weighting set. */
  probe: 'weights_do_not_total_100' | null;
}

export interface AssessmentInstance extends TenantRow {
  id: string;
  component_id: string;
  class_id: string;
  subject_id: string;
  term_id: string;
  administered_on: ISODate;
  state: 'open' | 'submitted' | 'locked';
}

export type ScoreState = 'recorded' | 'absent' | 'exempt' | 'pending';

export interface Score extends TenantRow {
  id: string;
  assessment_instance_id: string;
  student_id: string;
  raw_score: number | null;
  max_score: number;
  state: ScoreState;
  entered_by: string;
  entered_at: ISODateTime;
  captured_offline: boolean;
  synced_at: ISODateTime | null;
}

export interface GradingScale extends TenantRow {
  id: string;
  school_id: string;
  name: string;
  version: number;
  effective_from: ISODate;
  superseded_on: ISODate | null;
}

export interface GradeBand extends TenantRow {
  id: string;
  grading_scale_id: string;
  grade: string;
  min_percent: number;
  max_percent: number;
  remark: string;
  is_pass: boolean;
}

export type ResultSetState = 'draft' | 'under_review' | 'returned' | 'approved' | 'published';

export interface ResultSet extends TenantRow {
  id: string;
  class_id: string;
  term_id: string;
  state: ResultSetState;
  blocking_reasons: string[];
  submitted_by: string | null;
  approved_by: string | null;
  published_at: ISODateTime | null;
}

export interface ResultVersion extends TenantRow {
  id: string;
  result_set_id: string;
  version: number;
  published_at: ISODateTime;
  published_by: string;
  supersedes_version_id: string | null;
  reopen_reason: string | null;
  reopen_authorised_by: string | null;
  /** Immutability guarantee under FR-RES-030 — never UPDATE, only supersede. */
  is_current: boolean;
}

export interface ResultLine extends TenantRow {
  id: string;
  result_version_id: string;
  student_id: string;
  subject_id: string;
  weighted_percent: number;
  grade: string;
  position_in_class: number | null;
  teacher_comment: string | null;
}

/* ----------------------------------------------------------------- finance */

export interface FeeStructure extends TenantRow {
  id: string;
  school_id: string;
  academic_year_id: string;
  term_id: string;
  class_level_id: string;
  name: string;
}

export interface FeeItem extends TenantRow {
  id: string;
  fee_structure_id: string;
  category: 'tuition' | 'feeding' | 'transport' | 'exam' | 'pta' | 'uniform' | 'ict';
  amount: Pesewas;
  is_optional: boolean;
}

export type InvoiceStatus = 'draft' | 'issued' | 'part_paid' | 'paid' | 'overdue' | 'cancelled';

export interface Invoice extends TenantRow {
  id: string;
  student_id: string;
  term_id: string;
  invoice_no: string;
  status: InvoiceStatus;
  issued_on: ISODate;
  due_on: ISODate;
  total: Pesewas;
}

export interface InvoiceLine extends TenantRow {
  id: string;
  invoice_id: string;
  fee_item_id: string | null;
  description: string;
  amount: Pesewas;
  /** Proration for a mid-term joiner. */
  prorated_from: ISODate | null;
}

export type PaymentMethod = 'cash' | 'momo' | 'card' | 'bank_transfer';
export type PaymentState = 'pending' | 'confirmed' | 'failed' | 'reversed';

export interface Payment extends TenantRow {
  id: string;
  student_id: string;
  receipt_no: string;
  method: PaymentMethod;
  provider: string | null;
  provider_ref: string | null;
  amount: Pesewas;
  provider_fee: Pesewas;
  state: PaymentState;
  received_on: ISODate;
  received_by: string;
  /** Correcting entry, never a delete (FR-FIN-020). */
  reverses_payment_id: string | null;
  reversal_reason: string | null;
  reversal_requested_by: string | null;
  reversal_approved_by: string | null;
}

export interface Allocation extends TenantRow {
  id: string;
  payment_id: string;
  invoice_line_id: string;
  amount: Pesewas;
  allocated_by: string;
  allocated_at: ISODateTime;
}

export interface FinancialAssistance extends TenantRow {
  id: string;
  student_id: string;
  academic_year_id: string;
  kind: 'scholarship' | 'discount' | 'waiver';
  percent_off: number;
  reason: string;
  approved_by: string;
}

export interface ProviderSettlement extends TenantRow {
  id: string;
  school_id: string;
  provider: string;
  settled_on: ISODate;
  gross_amount: Pesewas;
  fee_amount: Pesewas;
  net_amount: Pesewas;
}

export interface SettlementLine extends TenantRow {
  id: string;
  settlement_id: string;
  provider_ref: string;
  amount: Pesewas;
  fee: Pesewas;
  payment_id: string | null;
  match_state: 'matched' | 'unmatched_provider' | 'unmatched_internal' | 'disputed';
}

/* ----------------------------------------------------------- communication */

export interface MessageTemplate extends TenantRow {
  id: string;
  school_id: string;
  name: string;
  channel: 'sms' | 'whatsapp' | 'email' | 'in_app';
  version: number;
  body: string;
}

export interface MessageBatch extends TenantRow {
  id: string;
  template_id: string;
  audience_description: string;
  channel: 'sms' | 'whatsapp' | 'email' | 'in_app';
  recipient_count: number;
  estimated_cost: Pesewas;
  sent_by: string;
  sent_at: ISODateTime;
}

export interface MessageDelivery extends TenantRow {
  id: string;
  batch_id: string;
  guardian_id: string;
  student_id: string;
  state: 'queued' | 'sent' | 'delivered' | 'failed' | 'suppressed_no_consent';
  failure_reason: string | null;
  attempts: number;
}

export interface ConsentRecord extends TenantRow {
  id: string;
  guardian_id: string;
  channel: 'sms' | 'whatsapp' | 'email';
  purpose: 'academic' | 'financial' | 'marketing';
  granted: boolean;
  changed_at: ISODateTime;
  source: 'admission_form' | 'parent_view' | 'staff_entry';
}

/* -------------------------------------------------- restricted / compliance */

export interface HealthRecord extends TenantRow {
  id: string;
  student_id: string;
  condition: string;
  medication: string | null;
  recorded_by: string;
  recorded_at: ISODateTime;
  access_role: 'health_officer';
}

export interface DisciplineCase extends TenantRow {
  id: string;
  student_id: string;
  summary: string;
  state: 'open' | 'investigating' | 'resolved' | 'appealed';
  opened_on: ISODate;
  access_role: 'headmaster';
}

export interface DataSubjectRequest extends TenantRow {
  id: string;
  subject_kind: 'guardian' | 'student';
  subject_id: string;
  kind: 'access' | 'rectification' | 'erasure' | 'portability';
  received_on: ISODate;
  due_on: ISODate; // received_on + 30 days (DP-030 / DP-090)
  state: 'received' | 'in_progress' | 'fulfilled' | 'refused';
}

export interface AuditEvent extends TenantRow {
  id: string;
  actor_kind: 'staff' | 'guardian' | 'platform' | 'system';
  actor_id: string;
  action: string;
  entity: string;
  entity_id: string;
  occurred_at: ISODateTime;
  detail: string;
}

/* ------------------------------------------------------------- the graph */

export interface TenantGraph {
  tenant: Tenant;
  schools: School[];
  campuses: Campus[];
  academic_years: AcademicYear[];
  terms: Term[];
  divisions: Division[];
  class_levels: ClassLevel[];
  classes: SchoolClass[];
  subjects: Subject[];
  teaching_assignments: TeachingAssignment[];
  staff: Staff[];
  students: Student[];
  enrolments: Enrolment[];
  guardians: Guardian[];
  guardian_links: GuardianLink[];
  users: User[];
  user_roles: UserRole[];
  invitations: Invitation[];
  password_reset_tokens: PasswordResetToken[];
  access_links: AccessLink[];
  attendance_records: AttendanceRecord[];
  attendance_conflicts: AttendanceConflict[];
  assessment_components: AssessmentComponent[];
  assessment_instances: AssessmentInstance[];
  scores: Score[];
  grading_scales: GradingScale[];
  grade_bands: GradeBand[];
  result_sets: ResultSet[];
  result_versions: ResultVersion[];
  result_lines: ResultLine[];
  fee_structures: FeeStructure[];
  fee_items: FeeItem[];
  invoices: Invoice[];
  invoice_lines: InvoiceLine[];
  payments: Payment[];
  allocations: Allocation[];
  financial_assistance: FinancialAssistance[];
  provider_settlements: ProviderSettlement[];
  settlement_lines: SettlementLine[];
  message_templates: MessageTemplate[];
  message_batches: MessageBatch[];
  message_deliveries: MessageDelivery[];
  consent_records: ConsentRecord[];
  health_records: HealthRecord[];
  discipline_cases: DisciplineCase[];
  data_subject_requests: DataSubjectRequest[];
  audit_events: AuditEvent[];
}

export interface SeedGraph {
  meta: {
    seed: string;
    generated_at: ISODateTime;
    generator_version: string;
    as_of: ISODate;
    guardian_cardinality: 'many_to_many' | 'one_to_many';
  };
  plans: Plan[];
  tenants: Tenant[];
  platform_users: PlatformUser[];
  metering: MeteringSnapshot[];
  platform_invoices: PlatformInvoice[];
  impersonation_grants: ImpersonationGrant[];
  by_tenant: TenantGraph[];
}

/** Table name -> ordered insert dependency. Used by writers/sql.ts. */
export const TENANT_TABLE_ORDER: (keyof TenantGraph)[] = [
  'schools',
  'campuses',
  'academic_years',
  'terms',
  'divisions',
  'class_levels',
  'staff',
  'classes',
  'subjects',
  'teaching_assignments',
  'students',
  'enrolments',
  'guardians',
  'guardian_links',
  'users',
  'user_roles',
  'invitations',
  'password_reset_tokens',
  'access_links',
  'attendance_records',
  'attendance_conflicts',
  'assessment_components',
  'assessment_instances',
  'scores',
  'grading_scales',
  'grade_bands',
  'result_sets',
  'result_versions',
  'result_lines',
  'fee_structures',
  'fee_items',
  'invoices',
  'invoice_lines',
  'payments',
  'allocations',
  'financial_assistance',
  'provider_settlements',
  'settlement_lines',
  'message_templates',
  'message_batches',
  'message_deliveries',
  'consent_records',
  'health_records',
  'discipline_cases',
  'data_subject_requests',
  'audit_events',
];
