import {
  ACADEMIC_ADMIN,
  ACADEMIC_STAFF,
  ADMISSIONS_TEAM,
  ALL_STAFF,
  HEALTH_TEAM,
  INVENTORY_TEAM,
  LEADERSHIP,
  LIBRARY_TEAM,
  TRANSPORT_TEAM,
} from './role-groups';

/**
 * A representative slice, not every eventual module (§13 Stage 5-9
 * territory). Each item routes to a stub page — Stage 2 has no real
 * screens yet — chosen to span the real role-tier spread (broad ALL_STAFF,
 * structural ACADEMIC_ADMIN, day-to-day ACADEMIC_STAFF, single-department
 * least-privilege LIBRARY_TEAM, and LEADERSHIP-only) so the
 * permission-generated mechanism is provably different per role without
 * enumerating every future screen. The spec's INSIGHT group ("only if
 * tenant has >1 school") is deferred — no multi-school detection exists
 * yet and Ch.27 Analytics was already skipped backend-side.
 */
export interface NavItem {
  label: string;
  href: string;
  requiredRoles: readonly string[];
  stageNote: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Finance keeps its own narrower [accountant + LEADERSHIP] shape backend-side
// (see finance.controller.ts's header) rather than a shared role-groups.ts
// constant — mirrored inline here for the same reason.
const FINANCE_TEAM = [...LEADERSHIP, 'accountant'] as const;

export const NAV_CONFIG: NavGroup[] = [
  {
    label: 'People',
    items: [
      { label: 'Students', href: '/students', requiredRoles: ALL_STAFF, stageNote: 'Stage 5' },
      { label: 'Admissions', href: '/admissions', requiredRoles: ADMISSIONS_TEAM, stageNote: 'gap closure' },
    ],
  },
  {
    label: 'Learning',
    items: [
      // Stage 4 promoted the Stage 3 proof screen into a real, separate
      // Teacher Field App shell (spec §6.2) — this link lands on that
      // shell's own Today home, not directly on the register, since the
      // shell's own bottom nav (Today/Register/Scores/More) is now how a
      // teacher moves between its screens. See apps/web/README.md's
      // Stage 4 section.
      { label: 'Teacher Field App', href: '/teacher', requiredRoles: ACADEMIC_STAFF, stageNote: 'Stage 4' },
      { label: 'Academic Structure', href: '/classes', requiredRoles: ACADEMIC_ADMIN, stageNote: 'Stage 5' },
      { label: 'Assessment', href: '/assessment', requiredRoles: ACADEMIC_STAFF, stageNote: 'Stage 5' },
      { label: 'Grading', href: '/grading', requiredRoles: ACADEMIC_STAFF, stageNote: 'Stage 5' },
      { label: 'Results', href: '/results', requiredRoles: ACADEMIC_STAFF, stageNote: 'Stage 5' },
    ],
  },
  {
    label: 'Money',
    items: [
      { label: 'Finance', href: '/finance', requiredRoles: FINANCE_TEAM, stageNote: 'Stage 7' },
    ],
  },
  {
    label: 'Communication',
    items: [
      { label: 'Communication', href: '/communication', requiredRoles: ACADEMIC_STAFF, stageNote: 'Stage 8' },
      { label: 'Analytics', href: '/analytics', requiredRoles: ACADEMIC_STAFF, stageNote: 'Stage 8' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Library', href: '/library', requiredRoles: LIBRARY_TEAM, stageNote: 'Stage 8' },
      { label: 'Transport', href: '/transport', requiredRoles: TRANSPORT_TEAM, stageNote: 'Stage 8' },
      { label: 'Health', href: '/health', requiredRoles: HEALTH_TEAM, stageNote: 'Stage 8' },
      { label: 'Discipline', href: '/discipline', requiredRoles: ACADEMIC_STAFF, stageNote: 'Stage 8' },
      { label: 'Inventory', href: '/inventory', requiredRoles: INVENTORY_TEAM, stageNote: 'Stage 8' },
    ],
  },
  {
    label: 'Compliance',
    items: [
      { label: 'Compliance', href: '/compliance', requiredRoles: ACADEMIC_STAFF, stageNote: 'Stage 8' },
      { label: 'Curriculum', href: '/curriculum', requiredRoles: ACADEMIC_STAFF, stageNote: 'Stage 8' },
    ],
  },
  {
    label: 'Settings',
    items: [
      // ALL_STAFF, not LEADERSHIP — Settings' Appearance (theme) section
      // has no role restriction of its own and every staff member should
      // be able to reach it to set their own preference; the page's own
      // canManage gate already restricts Staff directory/Class
      // assignments to ACADEMIC_ADMIN, so widening nav visibility here
      // doesn't expose anything new.
      { label: 'Settings', href: '/settings', requiredRoles: ALL_STAFF, stageNote: 'Stage 9' },
    ],
  },
];
