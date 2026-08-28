import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SeedConfig } from '../config.js';
import { FIXTURE_PASSWORDS } from '../generators/identity.js';
import type { SeedGraph, TenantGraph, User } from '../types.js';

/**
 * Writes the login sheet.
 *
 * Generated from the graph rather than written by hand, so it cannot drift.
 * A credentials document that says "headmaster@sunrise.edu.gh" while the
 * generator emits something else costs more time than having no document.
 */

function roleOf(g: TenantGraph, u: User): string {
  const roles = g.user_roles.filter((r) => r.user_id === u.id).map((r) => r.role);
  return [...new Set(roles)].join(' + ') || u.subject_kind;
}

function personName(g: TenantGraph, u: User): string {
  if (u.subject_kind === 'staff') {
    const s = g.staff.find((x) => x.id === u.subject_id);
    return s ? `${s.first_name} ${s.last_name}` : u.subject_id;
  }
  if (u.subject_kind === 'guardian') {
    const x = g.guardians.find((y) => y.id === u.subject_id);
    return x ? `${x.first_name} ${x.last_name}` : u.subject_id;
  }
  const s = g.students.find((x) => x.id === u.subject_id);
  return s ? `${s.first_name} ${s.last_name} (${s.admission_no})` : u.subject_id;
}

function passwordFor(role: string): string {
  const first = role.split(' + ')[0];
  return FIXTURE_PASSWORDS[first] ?? FIXTURE_PASSWORDS.teacher;
}

export function credentialsMarkdown(graph: SeedGraph, cfg: SeedConfig): string {
  const L: string[] = [];
  L.push('# PBSMS fixture credentials');
  L.push('');
  L.push(`seed \`${cfg.seed}\` · profile \`${cfg.profile}\` · as-of \`${cfg.asOf}\` · hash \`${cfg.hashMode}\``);
  L.push('');
  L.push('> **These passwords are published and the salts are derived, not random.**');
  L.push('> This file exists so a tester can log in without reading the generator.');
  L.push('> Never load this fixture into an environment that holds real people\'s data,');
  L.push('> and never let these hashes reach a production users table.');
  L.push('');

  L.push('## Platform Console');
  L.push('');
  L.push('| Email | Role | Password | MFA secret (base32) |');
  L.push('| --- | --- | --- | --- |');
  for (const p of graph.platform_users) {
    L.push(`| \`${p.email}\` | ${p.role} | \`${FIXTURE_PASSWORDS.platform}\` | \`${p.mfa_secret ?? '—'}\` |`);
  }
  L.push('');
  L.push('All platform users have MFA enabled — anyone who can impersonate into a');
  L.push('tenant should not be reachable with a password alone.');
  L.push('');

  for (const g of graph.by_tenant) {
    L.push(`## ${g.tenant.display_name} — \`${g.tenant.id}\`${g.tenant.status !== 'active' ? ` (**${g.tenant.status}**)` : ''}`);
    L.push('');
    if (g.tenant.status === 'suspended') {
      L.push('These credentials are valid. Login must still be refused on subscription');
      L.push('state, not on the credentials — that distinction is the point of this tenant.');
      L.push('');
    }

    const staffUsers = g.users.filter((u) => u.subject_kind === 'staff');
    L.push('### Staff Console');
    L.push('');
    L.push('| Email | Name | Roles | Password | Status | MFA |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    for (const u of staffUsers.slice(0, 40)) {
      const role = roleOf(g, u);
      const note = u.probe ? ` ⚑ ${u.probe}` : '';
      L.push(
        `| \`${u.login_email ?? '—'}\` | ${personName(g, u)} | ${role} | \`${passwordFor(role)}\` | ${u.status}${note} | ${u.mfa_enabled ? `\`${u.mfa_secret}\`` : '—'} |`,
      );
    }
    if (staffUsers.length > 40) L.push(`| … | ${staffUsers.length - 40} more staff accounts | | | | |`);
    L.push('');

    const teacher = staffUsers.find((u) => u.status === 'active' && roleOf(g, u).includes('teacher'));
    if (teacher) {
      const classes = g.user_roles.filter((r) => r.user_id === teacher.id && r.scope_kind === 'class')
        .map((r) => g.classes.find((c) => c.id === r.scope_id)?.name)
        .filter(Boolean);
      L.push(`**Teacher Field App:** \`${teacher.login_email}\` / \`${FIXTURE_PASSWORDS.teacher}\` — scoped to ${classes.join(', ') || 'no class'}.`);
      L.push('');
    }

    const guardianUser = g.users.find((u) => u.subject_kind === 'guardian' && u.last_login_at !== null);
    if (guardianUser) {
      L.push('### Parent View');
      L.push('');
      L.push(`Guardians authenticate by phone and OTP, not a password. Sample: \`${guardianUser.login_phone}\`.`);
      L.push('');
      L.push('Most guardians reach the Parent View through a link instead. Three link states are seeded:');
      L.push('');
      L.push('| Purpose | Token | Expires | Used |');
      L.push('| --- | --- | --- | --- |');
      for (const l of g.access_links.slice(0, 3)) {
        L.push(`| ${l.purpose} | \`${l.token.slice(0, 20)}…\` | ${l.expires_at.slice(0, 10)} | ${l.used_at ? l.used_at.slice(0, 10) : 'no'} |`);
      }
      L.push('');
    }

    const studentUser = g.users.find((u) => u.subject_kind === 'student');
    if (studentUser) {
      L.push(`### Student · JHS only`);
      L.push('');
      L.push(`Username is the admission number. Sample: ${personName(g, studentUser)} / \`${FIXTURE_PASSWORDS.student}\` — must change on first login.`);
      L.push('');
    }

    const flagged = g.users.filter((u) => u.probe);
    if (flagged.length > 0) {
      L.push('### Accounts that should NOT simply work');
      L.push('');
      L.push('| Account | Probe | Expected behaviour |');
      L.push('| --- | --- | --- |');
      const expected: Record<string, string> = {
        locked_account: 'Correct password still refused while `locked_until` is in the future.',
        never_activated: 'No hash exists. Must fail differently from a wrong password, and the invitation token must still work.',
        departed_staff: 'Disabled. Login refused, but their marking history stays intact and attributed.',
        conflict_of_interest: 'Holds accountant and headmaster. Must be refused as their own four-eyes approver (FR-FIN-020).',
        email_reused_across_tenants: 'Same address exists in another tenant. Must resolve to exactly one account per tenant context.',
      };
      for (const u of flagged) {
        L.push(`| \`${u.login_email ?? u.login_phone ?? u.id}\` | ${u.probe} | ${expected[u.probe!] ?? '—'} |`);
      }
      L.push('');
    }
  }

  L.push('---');
  L.push('');
  L.push('## Regenerating');
  L.push('');
  L.push('```bash');
  L.push('pnpm seed -- --profile ci --hash scrypt   # fixture-grade scrypt hashes');
  L.push('pnpm seed -- --profile ci --hash none     # plain:<password>, rehash on load');
  L.push('```');
  L.push('');
  L.push('Use `--hash none` if your auth service owns hashing. The generator writes');
  L.push('`plain:<password>` into `password_hash` and records `plaintext` in');
  L.push('`password_algo`, so a loader can hash with your own argon2id parameters and');
  L.push('a stray plaintext row is trivially greppable if one ever escapes.');

  return L.join('\n');
}

export function writeCredentials(graph: SeedGraph, cfg: SeedConfig, dir: string): string {
  const p = join(dir, 'CREDENTIALS.md');
  writeFileSync(p, credentialsMarkdown(graph, cfg));
  return p;
}
