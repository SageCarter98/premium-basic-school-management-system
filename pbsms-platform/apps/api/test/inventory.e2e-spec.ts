/**
 * inventory.e2e-spec.ts
 *
 * Chapter 28 (Inventory), FR-OPS-050 — genuinely untested before this
 * file (no existing suite constructs InventoryService).
 *
 * Covers:
 *  - receiveStock(): increments quantity_on_hand.
 *  - issueStock(): rejects a bogus staff issuedToId before any decrement
 *    is attempted; locks the item row, decrements quantity_on_hand, and
 *    refuses once the requested quantity exceeds what's on hand (same
 *    "lock, check, decrement" shape as library's issueLoan()).
 *  - The low-stock alert: crossing at-or-below reorder_threshold with a
 *    notifyRecipientId + notifyRecipientEmail/-Name dispatches a real
 *    'normal'-sensitivity notification and records an inventory_alerts
 *    row; staying above the threshold does neither.
 *
 * Harness pattern copied from results-immutability.e2e-spec.ts — same
 * WorkerTenantConnection + TenantContextStore.run() idiom, same per-file
 * fixture tracking and afterAll cleanup.
 *
 * Requires a running Postgres with every migration through
 * 0015_inventory.sql (and everything seed_demo.sql needs) already
 * applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { GuardiansService } from '../src/modules/guardians/guardians.service';
import { CommunicationService } from '../src/modules/communication/communication.service';
import { StaffService } from '../src/modules/staff/staff.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise
const TEACHER_SUNRISE = '99999999-0000-0000-0000-000000000003'; // teacher@sunrise, seed_demo.sql's only real seeded teacher

function asUser<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Inventory (Chapter 28 FR-OPS-050)', () => {
  let pool: Pool;
  const itemIds: string[] = [];
  const issuanceIds: string[] = [];
  const alertItemIds: string[] = [];
  const notificationIds: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      await asUser(async () => {
        await cleanup.query(`delete from inventory_alerts where item_id = any($1::uuid[])`, [alertItemIds]);
        await cleanup.query(`delete from notification_deliveries where notification_id = any($1::uuid[])`, [notificationIds]);
        await cleanup.query(`delete from notifications where id = any($1::uuid[])`, [notificationIds]);
        await cleanup.query(`delete from inventory_issuances where id = any($1::uuid[])`, [issuanceIds]);
        await cleanup.query(`delete from inventory_items where id = any($1::uuid[])`, [itemIds]);
      });
    } finally {
      cleanup.release();
      await pool.end();
    }
  });

  function harness(): { conn: WorkerTenantConnection; service: InventoryService } {
    const conn = new WorkerTenantConnection(pool);
    const guardians = new GuardiansService(conn);
    const communication = new CommunicationService(conn, new StaffService(conn), guardians);
    return { conn, service: new InventoryService(conn, communication, new StaffService(conn)) };
  }

  async function createItem(service: InventoryService, quantityOnHand: number, reorderThreshold: number) {
    const item = await asUser(() =>
      service.createItem({ name: uniqueName('Fixture Chalk'), quantityOnHand, reorderThreshold } as never),
    );
    itemIds.push(item.id);
    return item;
  }

  describe('receiveStock()', () => {
    it('increments quantity_on_hand', async () => {
      const { conn, service } = harness();
      try {
        const item = await createItem(service, 10, 5);
        const received = await asUser(() => service.receiveStock(item.id, { quantity: 20 } as never));
        expect(received.quantity_on_hand).toBe(30);
      } finally {
        conn.release();
      }
    });
  });

  describe('issueStock()', () => {
    it('rejects a bogus staff issuedToId before any decrement is attempted', async () => {
      const { conn, service } = harness();
      try {
        const item = await createItem(service, 10, 2);
        await expect(
          asUser(() =>
            service.issueStock(item.id, {
              issuedToType: 'staff',
              issuedToId: '00000000-0000-0000-0000-000000000000',
              quantity: 1,
              issuedBy: HEADMASTER,
            } as never),
          ),
        ).rejects.toThrow(/not a real staff member/);

        const unchanged = await asUser(() => service.findItem(item.id));
        expect(unchanged.quantity_on_hand).toBe(10);
      } finally {
        conn.release();
      }
    });

    it('decrements quantity_on_hand and refuses once the requested quantity exceeds what is on hand', async () => {
      const { conn, service } = harness();
      try {
        const item = await createItem(service, 5, 1);
        const issuance = await asUser(() =>
          service.issueStock(item.id, { issuedToType: 'staff', issuedToId: TEACHER_SUNRISE, quantity: 3, issuedBy: HEADMASTER } as never),
        );
        issuanceIds.push(issuance.id);

        const afterFirst = await asUser(() => service.findItem(item.id));
        expect(afterFirst.quantity_on_hand).toBe(2);

        await expect(
          asUser(() =>
            service.issueStock(item.id, { issuedToType: 'staff', issuedToId: TEACHER_SUNRISE, quantity: 3, issuedBy: HEADMASTER } as never),
          ),
        ).rejects.toThrow(/only 2 on hand/);

        const unchanged = await asUser(() => service.findItem(item.id));
        expect(unchanged.quantity_on_hand).toBe(2);
      } finally {
        conn.release();
      }
    });
  });

  describe('Low-stock alert', () => {
    it('dispatches a real notification and records an alert once quantity_on_hand falls to or below the threshold', async () => {
      const { conn, service } = harness();
      try {
        const item = await createItem(service, 5, 4);
        alertItemIds.push(item.id);

        const issuance = await asUser(() =>
          service.issueStock(item.id, {
            issuedToType: 'staff',
            issuedToId: TEACHER_SUNRISE,
            quantity: 2,
            issuedBy: HEADMASTER,
            notifyRecipientId: TEACHER_SUNRISE,
            notifyRecipientName: 'Storekeeper',
            notifyRecipientEmail: 'teacher@sunrise.pbsms.test',
          } as never),
        );
        issuanceIds.push(issuance.id);

        const afterIssue = await asUser(() => service.findItem(item.id));
        expect(afterIssue.quantity_on_hand).toBe(3); // at/below reorder_threshold of 4

        const alerts = await asUser(() =>
          conn.query<{ notification_id: string; quantity_on_hand: number }>(
            `select notification_id, quantity_on_hand from inventory_alerts where item_id = $1`,
            [item.id],
          ),
        );
        expect(alerts).toHaveLength(1);
        expect(alerts[0].quantity_on_hand).toBe(3);
        expect(alerts[0].notification_id).not.toBeNull();
        notificationIds.push(alerts[0].notification_id);

        const deliveries = await asUser(() =>
          conn.query<{ channel: string }>(`select channel from notification_deliveries where notification_id = $1`, [
            alerts[0].notification_id,
          ]),
        );
        expect(deliveries.length).toBeGreaterThan(0);
      } finally {
        conn.release();
      }
    });

    it('does not create an alert while quantity_on_hand stays above the threshold', async () => {
      const { conn, service } = harness();
      try {
        const item = await createItem(service, 50, 4);
        alertItemIds.push(item.id);

        const issuance = await asUser(() =>
          service.issueStock(item.id, {
            issuedToType: 'staff',
            issuedToId: TEACHER_SUNRISE,
            quantity: 2,
            issuedBy: HEADMASTER,
            notifyRecipientId: TEACHER_SUNRISE,
            notifyRecipientName: 'Storekeeper',
            notifyRecipientEmail: 'teacher@sunrise.pbsms.test',
          } as never),
        );
        issuanceIds.push(issuance.id);

        const alerts = await asUser(() =>
          conn.query<{ id: string }>(`select id from inventory_alerts where item_id = $1`, [item.id]),
        );
        expect(alerts).toHaveLength(0);
      } finally {
        conn.release();
      }
    });
  });
});
