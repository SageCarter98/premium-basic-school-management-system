import { type SeedConfig, type TenantSpec } from '../config.js';
import { hashPassword, token, totpSecret, type HashMode } from '../credentials.js';
import { addDays, at, nextId, type Rng } from '../rng.js';
import type {
  AccessLink, Invitation, PasswordResetToken, StaffRole, TenantGraph, User, UserRole,
} from '../types.js';

/**
 * Shared fixture passwords, one per role tier. Published in CREDENTIALS.md.
 *
 * Shared rather than per-user because a tester needs to be able to log in as a
 * headmaster without looking anything up, and because memoised hashing of six
 * distinct passwords costs six scrypt calls instead of several thousand.
 */
export const FIXTURE_PASSWORDS: Record<string, string> = {
  proprietor: 'Pbsms!Proprietor2026',
  headmaster: 'Pbsms!Head2026',
  accountant: 'Pbsms!Bursar2026',
  academic_coordinator: 'Pbsms!Coord2026',
  admissions_officer: 'Pbsms!Admissions2026',
  health_officer: 'Pbsms!Health2026',
  teacher: 'Pbsms!Teacher2026',
  student: 'Pbsms!Student2026',
  platform: 'Pbsms!Platform2026',
};

/** Scope of each role, per Chapter 13. Teachers are class-scoped; the rest are wider. */
const ROLE_SCOPE: Record<StaffRole, 'tenant' | 'school' | 'class'> = {
  proprietor: 'tenant',
  headmaster: 'school',
  accountant: 'school',
  academic_coordinator: 'school',
  admissions_officer: 'school',
  health_officer: 'school',
  teacher: 'class',
};

export function generateIdentity(g: TenantGraph, spec: TenantSpec, cfg: SeedConfig, rng: Rng): void {
  const tid = g.tenant.id;
  const scope = spec.slug;
  const seed = cfg.seed;
  const mode: HashMode = cfg.hashMode;
  const iRng = rng.stream('identity');

  const pw = (role: string) => hashPassword(FIXTURE_PASSWORDS[role] ?? FIXTURE_PASSWORDS.teacher, mode, seed);

  for (const school of g.schools) {
    const staff = g.staff.filter((s) => s.school_id === school.id);
    const students = g.students.filter((s) => s.school_id === school.id);
    const studentIds = new Set(students.map((s) => s.id));
    const links = g.guardian_links.filter((l) => studentIds.has(l.student_id));
    const guardianIds = [...new Set(links.map((l) => l.guardian_id))];
    const campusIds = new Set(g.campuses.filter((c) => c.school_id === school.id).map((c) => c.id));
    const years = g.academic_years.filter((y) => y.school_id === school.id).sort((a, b) => a.label.localeCompare(b.label));
    const currentYear = years[years.length - 1];
    const currentClasses = g.classes.filter((c) => campusIds.has(c.campus_id) && c.academic_year_id === currentYear.id);

    /* ------------------------------------------------------- staff users */
    for (const s of staff) {
      const primaryRole = s.roles[0];
      const { algo, hash } = pw(primaryRole);
      const user: User = {
        tenant_id: tid,
        id: nextId('usr', scope),
        subject_kind: 'staff',
        subject_id: s.id,
        login_email: s.email,
        login_phone: s.phone,
        auth_method: 'password',
        password_algo: algo,
        password_hash: hash,
        must_change_password: false,
        // MFA on money and platform-adjacent roles only. Requiring it of every
        // teacher on a shared classroom phone is how a school ends up sharing
        // one account, which is worse than no MFA.
        mfa_enabled: s.roles.includes('accountant') || s.roles.includes('proprietor'),
        mfa_secret: null,
        status: 'active',
        failed_login_count: 0,
        locked_until: null,
        last_login_at: at(addDays(cfg.asOf, -iRng.int(0, 9)), 7, iRng.int(0, 59)),
        created_at: at('2025-08-20', 9, 0),
        probe: null,
      };
      if (user.mfa_enabled) user.mfa_secret = totpSecret(seed, user.id);
      g.users.push(user);

      for (const role of s.roles) {
        const kind = ROLE_SCOPE[role];
        if (kind === 'class') {
          // Class-scoped: one row per class the teacher actually holds, so an
          // over-broad query returning another class's roster fails visibly.
          const assigned = currentClasses.filter((c) => c.class_teacher_id === s.id);
          const held = assigned.length > 0 ? assigned : currentClasses.slice(0, 1);
          for (const c of held) {
            g.user_roles.push({
              tenant_id: tid, id: nextId('url', scope), user_id: user.id,
              role, scope_kind: 'class', scope_id: c.id,
            });
          }
        } else {
          g.user_roles.push({
            tenant_id: tid, id: nextId('url', scope), user_id: user.id,
            role, scope_kind: kind, scope_id: kind === 'tenant' ? null : school.id,
          });
        }
      }
    }

    /* ---------------------------------------------------- guardian users */
    // Phone plus OTP, not email plus password. A guardian on a low-cost Android
    // arriving from a WhatsApp link has a phone number and may well not have a
    // working email address; forcing a password on them is how the Parent View
    // ends up unused.
    for (const gid of guardianIds) {
      const guardian = g.guardians.find((x) => x.id === gid)!;
      g.users.push({
        tenant_id: tid,
        id: nextId('usr', scope),
        subject_kind: 'guardian',
        subject_id: gid,
        login_email: guardian.email,
        login_phone: guardian.phone,
        auth_method: 'otp',
        password_algo: null,
        password_hash: null,
        must_change_password: false,
        mfa_enabled: false,
        mfa_secret: null,
        status: 'active',
        failed_login_count: 0,
        locked_until: null,
        last_login_at: iRng.bool(0.55) ? at(addDays(cfg.asOf, -iRng.int(1, 40)), 19, iRng.int(0, 59)) : null,
        created_at: at('2025-09-01', 9, 0),
        probe: null,
      });
    }
    const guardianUsers = g.users.filter((u) => u.subject_kind === 'guardian' && guardianIds.includes(u.subject_id));
    for (const u of guardianUsers) {
      g.user_roles.push({
        tenant_id: tid, id: nextId('url', scope), user_id: u.id,
        role: 'guardian', scope_kind: 'tenant', scope_id: null,
      });
    }

    /* ----------------------------------------------------- student users */
    // JHS only. A Nursery 1 pupil does not get a login, and a fixture that
    // gives them one will not catch the code that assumes they do.
    const jhsLevelIds = new Set(
      g.class_levels
        .filter((l) => g.divisions.some((d) => d.id === l.division_id && d.school_id === school.id && d.name === 'Junior High School'))
        .map((l) => l.id),
    );
    const jhsStudents = students.filter((s) =>
      g.enrolments.some((e) => e.student_id === s.id && e.is_current && jhsLevelIds.has(g.classes.find((c) => c.id === e.class_id)?.class_level_id ?? '')),
    );
    const { algo: sAlgo, hash: sHash } = pw('student');
    for (const s of jhsStudents) {
      const u: User = {
        tenant_id: tid,
        id: nextId('usr', scope),
        subject_kind: 'student',
        subject_id: s.id,
        login_email: null,
        login_phone: null,
        auth_method: 'password',
        password_algo: sAlgo,
        password_hash: sHash,
        must_change_password: true,
        mfa_enabled: false,
        mfa_secret: null,
        status: 'active',
        failed_login_count: 0,
        locked_until: null,
        last_login_at: null,
        created_at: at('2025-09-15', 9, 0),
        probe: null,
      };
      g.users.push(u);
      g.user_roles.push({
        tenant_id: tid, id: nextId('url', scope), user_id: u.id,
        role: 'student', scope_kind: 'tenant', scope_id: null,
      });
    }

    /* --------------------------------------------------- auth edge cases */
    const staffUsers = g.users.filter((u) => u.subject_kind === 'staff' && staff.some((s) => s.id === u.subject_id));
    const teacherUsers = staffUsers.filter((u) => {
      const s = staff.find((x) => x.id === u.subject_id)!;
      return s.roles.includes('teacher');
    });
    const head = staffUsers.find((u) => staff.find((s) => s.id === u.subject_id)!.roles.includes('headmaster'))!;

    // 1. Locked after repeated failures. Correct credentials must still be
    //    refused while locked_until is in the future.
    if (teacherUsers.length > 1) {
      const locked = teacherUsers[1];
      locked.status = 'locked';
      locked.failed_login_count = 5;
      locked.locked_until = at(addDays(cfg.asOf, 1), 9, 0);
      locked.probe = 'locked_account';
    }

    // 2. Invited, never activated. No password hash exists yet, so a login
    //    attempt must fail differently from a wrong password.
    if (teacherUsers.length > 2) {
      const invited = teacherUsers[2];
      invited.status = 'invited';
      invited.password_hash = null;
      invited.password_algo = null;
      invited.last_login_at = null;
      invited.probe = 'never_activated';
      g.invitations.push({
        tenant_id: tid,
        id: nextId('inv2', scope),
        user_id: invited.id,
        email: invited.login_email ?? '',
        token: token(seed, 'invite', invited.id),
        invited_by: head.id,
        invited_at: at(addDays(cfg.asOf, -4), 10, 0),
        expires_at: at(addDays(cfg.asOf, 3), 10, 0),
        accepted_at: null,
      });
    }

    // 3. Disabled — a teacher who left. Their marking history stays; the login
    //    does not. Deleting the user instead would orphan every score they
    //    entered, which is why identity is a separate row from the person.
    if (teacherUsers.length > 3) {
      const gone = teacherUsers[3];
      gone.status = 'disabled';
      gone.probe = 'departed_staff';
      const s = staff.find((x) => x.id === gone.subject_id);
      if (s) s.is_active = false;
    }

    // 4. Conflict of interest: one user holding both accountant and headmaster.
    //    Chapter 13 asks for a warning on this, and FR-FIN-020's four-eyes rule
    //    has to refuse this person as their own approver.
    const accountantUser = staffUsers.find((u) => staff.find((s) => s.id === u.subject_id)!.roles.includes('accountant'));
    if (accountantUser) {
      g.user_roles.push({
        tenant_id: tid, id: nextId('url', scope), user_id: accountantUser.id,
        role: 'headmaster', scope_kind: 'school', scope_id: school.id,
      });
      accountantUser.probe = 'conflict_of_interest';
    }

    // 5. Password reset tokens: one live, one expired, one already consumed.
    if (staffUsers.length > 4) {
      const targets = staffUsers.slice(0, 3);
      const specs: { ago: number; ttl: number; used: boolean }[] = [
        { ago: 0, ttl: 1, used: false },   // valid
        { ago: 6, ttl: 1, used: false },   // expired
        { ago: 3, ttl: 1, used: true },    // consumed
      ];
      targets.forEach((u, i) => {
        const sp = specs[i];
        const requested = addDays(cfg.asOf, -sp.ago);
        g.password_reset_tokens.push({
          tenant_id: tid,
          id: nextId('prt', scope),
          user_id: u.id,
          token: token(seed, 'reset', `${u.id}:${i}`),
          requested_at: at(requested, 12, 0),
          expires_at: at(addDays(requested, sp.ttl), 12, 0),
          used_at: sp.used ? at(requested, 12, 18) : null,
        });
      });
    }

    // 6. Parent access links: one live, one expired, one already used. These
    //    are the credential for the Parent View, so they need the same three
    //    states any credential does.
    const linkSpecs: { purpose: AccessLink['purpose']; ago: number; ttl: number; used: boolean }[] = [
      { purpose: 'report_card', ago: 1, ttl: 14, used: false },
      { purpose: 'invoice', ago: 40, ttl: 14, used: false },
      { purpose: 'statement', ago: 9, ttl: 14, used: true },
    ];
    links.slice(0, linkSpecs.length).forEach((l, i) => {
      const sp = linkSpecs[i];
      const issued = addDays(cfg.asOf, -sp.ago);
      g.access_links.push({
        tenant_id: tid,
        id: nextId('alk', scope),
        guardian_id: l.guardian_id,
        student_id: l.student_id,
        purpose: sp.purpose,
        token: token(seed, 'access', `${l.id}:${sp.purpose}`),
        channel: 'whatsapp',
        issued_at: at(issued, 13, 5),
        expires_at: at(addDays(issued, sp.ttl), 13, 5),
        used_at: sp.used ? at(addDays(issued, 1), 20, 12) : null,
      });
    });
  }

  /* ------------------------------------------------- cross-tenant probe */
  // One address deliberately reused in two tenants. If the unique index on
  // login_email is global rather than (tenant_id, login_email), loading the
  // fixture fails here — and that failure is the finding. A shared email is
  // ordinary in this market: one proprietor runs two schools, or a teacher
  // moonlights at a second.
  if (spec.slug === 'sunrise' || spec.slug === 'brightfuture') {
    const target = g.users.find((u) => u.subject_kind === 'staff' && u.status === 'active');
    if (target) {
      target.login_email = 'shared.principal@example.gh';
      target.probe = 'email_reused_across_tenants';
    }
  }
}
