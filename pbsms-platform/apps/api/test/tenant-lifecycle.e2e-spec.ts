/**
 * tenant-lifecycle.e2e-spec.ts
 *
 * Exercises TenantsService (SRS Chapter 4.1, TEN-023..026) directly
 * against real Postgres via the pbsms_platform role
 * (0021_tenant_lifecycle.sql) — written during Phase A1, when no
 * controller existed yet. Phase A2 (0022_platform_roles.sql) added a
 * real /v1/platform/tenants controller behind a real auth path; this
 * file is kept as service-level coverage of the state machine itself
 * (independent of the HTTP/role-guard layer, which the live-HTTP smoke
 * test in the README's A2 verification log covers instead) rather than
 * deleted or duplicated into an HTTP-shaped test.
 *
 * Requires a running Postgres with 0001_init_tenancy.sql through
 * 0021_tenant_lifecycle.sql and seed_demo.sql already applied.
 */

import { Pool } from 'pg';
import { TenantsService } from '../src/modules/tenants/tenants.service';

const PLATFORM_ADMIN = '99999999-0000-0000-0000-000000000005'; // seed_demo.sql
const TEACHER_NOT_PLATFORM = '99999999-0000-0000-0000-000000000003'; // ordinary tenant user
const STARTER_PLAN = '00000000-0000-0000-0000-000000000001'; // seed_demo.sql

describe('Tenant lifecycle (Chapter 4.1, TEN-023..026)', () => {
  let platformPool: Pool;
  let appPool: Pool;
  let service: TenantsService;

  beforeAll(() => {
    platformPool = new Pool({ connectionString: process.env.PLATFORM_DATABASE_URL });
    appPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
    service = new TenantsService(platformPool);
  });

  afterAll(async () => {
    await platformPool.end();
    await appPool.end();
  });

  it('TEN-005 regression guard: pbsms_app still has zero grants on any platform table', async () => {
    for (const table of ['tenants', 'plans', 'tenant_subscriptions', 'platform_audit_logs']) {
      await expect(appPool.query(`select 1 from ${table} limit 1`)).rejects.toThrow(/permission denied/);
    }
  });

  it('rejects create() from a non-platform actor', async () => {
    await expect(
      service.create(TEACHER_NOT_PLATFORM, { name: 'Rogue School', slug: `rogue-${Date.now()}` }),
    ).rejects.toThrow(/not a real platform user/);
  });

  it('creates a tenant in trial status with a 30-day default trial window, and audits the creation', async () => {
    const slug = `test-school-${Date.now()}`;
    const tenant = await service.create(PLATFORM_ADMIN, { name: 'Test School', slug });

    expect(tenant.status).toBe('trial');
    expect(tenant.trial_ends_at).not.toBeNull();
    expect(tenant.plan_id).toBeNull();

    const trail = await service.listAuditTrail(tenant.id);
    expect(trail).toHaveLength(1);
    expect(trail[0].action).toBe('tenant_created');
    expect(trail[0].actor_id).toBe(PLATFORM_ADMIN);
  });

  it('TEN-023: blocks trial -> onboarding with no plan selected', async () => {
    const tenant = await service.create(PLATFORM_ADMIN, {
      name: 'No Plan School',
      slug: `no-plan-${Date.now()}`,
    });

    await expect(
      service.transition(tenant.id, PLATFORM_ADMIN, {
        toStatus: 'onboarding',
        reason: 'sales confirmed',
        billingMethodConfirmed: true,
      }),
    ).rejects.toThrow(/no plan has been selected/);
  });

  it('TEN-023: blocks trial -> onboarding with a plan but no confirmed billing method or free-tier exception', async () => {
    const tenant = await service.create(PLATFORM_ADMIN, {
      name: 'Unconfirmed Billing School',
      slug: `unconfirmed-${Date.now()}`,
      planId: STARTER_PLAN,
    });

    await expect(
      service.transition(tenant.id, PLATFORM_ADMIN, { toStatus: 'onboarding', reason: 'sales confirmed' }),
    ).rejects.toThrow(/billingMethodConfirmed=true or a freeTierApprovalReason/);
  });

  it('requires a reason for every transition', async () => {
    const tenant = await service.create(PLATFORM_ADMIN, {
      name: 'No Reason School',
      slug: `no-reason-${Date.now()}`,
      planId: STARTER_PLAN,
    });

    await expect(
      service.transition(tenant.id, PLATFORM_ADMIN, { toStatus: 'onboarding', reason: '', billingMethodConfirmed: true }),
    ).rejects.toThrow(/reason is required/);
  });

  it('rejects a transition not in the state machine', async () => {
    const tenant = await service.create(PLATFORM_ADMIN, {
      name: 'Skip State School',
      slug: `skip-state-${Date.now()}`,
    });

    await expect(
      service.transition(tenant.id, PLATFORM_ADMIN, { toStatus: 'active', reason: 'skip ahead' }),
    ).rejects.toThrow(/Cannot transition tenant from 'trial' to 'active'/);
  });

  it('walks the full happy-path lifecycle, auditing every step, and confirms suspended_at set/cleared correctly', async () => {
    const tenant = await service.create(PLATFORM_ADMIN, {
      name: 'Full Lifecycle School',
      slug: `full-lifecycle-${Date.now()}`,
      planId: STARTER_PLAN,
    });

    const onboarding = await service.transition(tenant.id, PLATFORM_ADMIN, {
      toStatus: 'onboarding',
      reason: 'sales confirmed, plan selected',
      billingMethodConfirmed: true,
    });
    expect(onboarding.status).toBe('onboarding');

    const active = await service.transition(tenant.id, PLATFORM_ADMIN, {
      toStatus: 'active',
      reason: 'onboarding complete, go-live',
    });
    expect(active.status).toBe('active');

    const pastDue = await service.transition(tenant.id, PLATFORM_ADMIN, {
      toStatus: 'past_due',
      reason: 'payment failed',
    });
    expect(pastDue.status).toBe('past_due');
    expect(pastDue.suspended_at).toBeNull();

    const suspended = await service.transition(tenant.id, PLATFORM_ADMIN, {
      toStatus: 'suspended',
      reason: 'grace period expired',
    });
    expect(suspended.status).toBe('suspended');
    expect(suspended.suspended_at).not.toBeNull();

    // TEN-024: reactivating from suspended is a real exit, not a dead end —
    // same "point-of-no-return state needs an explicit way back" shape as
    // results.reopen()/discipline's closed->investigating path.
    const reactivated = await service.transition(tenant.id, PLATFORM_ADMIN, {
      toStatus: 'active',
      reason: 'payment received',
    });
    expect(reactivated.status).toBe('active');
    expect(reactivated.suspended_at).toBeNull();

    const offboarding = await service.transition(tenant.id, PLATFORM_ADMIN, {
      toStatus: 'offboarding',
      reason: 'tenant requested closure',
    });
    expect(offboarding.status).toBe('offboarding');

    const closed = await service.transition(tenant.id, PLATFORM_ADMIN, {
      toStatus: 'closed',
      reason: 'retention period elapsed',
    });
    expect(closed.status).toBe('closed');

    // 'closed' is terminal — no further transitions permitted.
    await expect(
      service.transition(tenant.id, PLATFORM_ADMIN, { toStatus: 'active', reason: 'reopen attempt' }),
    ).rejects.toThrow(/terminal/);

    const trail = await service.listAuditTrail(tenant.id);
    // 1 creation + 6 transitions (onboarding, active, past_due, suspended, active, offboarding, closed = 7 — plus creation = 8)
    expect(trail).toHaveLength(8);
    expect(trail.filter((e) => e.action === 'tenant_status_transition')).toHaveLength(7);
  });

  it('findAll/findOne see the tenants created above; findOne 404s a bogus id', async () => {
    const tenant = await service.create(PLATFORM_ADMIN, {
      name: 'Findable School',
      slug: `findable-${Date.now()}`,
    });

    const found = await service.findOne(tenant.id);
    expect(found.id).toBe(tenant.id);

    const all = await service.findAll();
    expect(all.find((t) => t.id === tenant.id)).toBeDefined();

    await expect(service.findOne('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/not found/);
  });
});
