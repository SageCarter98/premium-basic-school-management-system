/**
 * transport.e2e-spec.ts
 *
 * Chapter 28 (Transport), FR-OPS-020 — genuinely untested before this
 * file (no existing suite constructs TransportService). Unlike most of
 * this codebase's "no real provider" gaps (payments, WhatsApp/SMS), the
 * "optional GPS-based arrival notification integration" FR-OPS-020 itself
 * calls out is actually built here: recordVehicleLocation() is the real
 * seam a GPS device would call, and checkArrivals()'s distance/cooldown
 * logic is genuine, self-contained business logic worth testing on its
 * own merits.
 *
 * Covers:
 *  - assignVehicleToRoute()/assignDriverToVehicle(): basic linkage.
 *  - assignStudentToRoute(): supersedes any prior active assignment for
 *    the student (old -> 'ended', new -> 'active') rather than allowing
 *    two simultaneously-active assignments.
 *  - endAssignment(): refuses on an already-ended assignment, 404s on an
 *    unknown id.
 *  - The GPS arrival pipeline: a vehicle location within
 *    ARRIVAL_THRESHOLD_METERS of a geo-located stop creates a
 *    transport_stop_arrivals row and a real notification (via
 *    CommunicationService) to every guardian of every student assigned to
 *    that stop; a location outside the threshold triggers nothing; a
 *    second near-ping within the cooldown window doesn't re-notify.
 *
 * Harness pattern copied from results-immutability.e2e-spec.ts — same
 * WorkerTenantConnection + TenantContextStore.run() idiom, same per-file
 * fixture tracking and afterAll cleanup. transport_vehicle_locations/
 * transport_stop_arrivals are append-only for pbsms_app (select+insert
 * only, 0035_transport_gps.sql) — their teardown needs the schema-owning
 * role instead, same MIGRATE_DATABASE_URL pattern
 * tenant-lifecycle.e2e-spec.ts uses for audit_log/platform_audit_logs.
 *
 * Requires a running Postgres with every migration through
 * 0035_transport_gps.sql (and everything seed_demo.sql needs) already
 * applied.
 */

import { Pool } from 'pg';
import { WorkerTenantConnection } from '../src/common/database/worker-tenant-connection';
import { TenantContextStore } from '../src/common/tenant/tenant-context';
import { TransportService } from '../src/modules/transport/transport.service';
import { GuardiansService } from '../src/modules/guardians/guardians.service';
import { CommunicationService } from '../src/modules/communication/communication.service';
import { StaffService } from '../src/modules/staff/staff.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111'; // Sunrise Basic School
const SCHOOL_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const HEADMASTER = '99999999-0000-0000-0000-000000000001'; // admin@sunrise

// Real coordinates for Sunrise's neighbourhood — Accra, Ghana. ~30m apart
// (well inside ARRIVAL_THRESHOLD_METERS) vs. ~5.5km apart (well outside).
const STOP_LAT = 5.6037;
const STOP_LON = -0.187;
const NEAR_LAT = 5.6039;
const NEAR_LON = -0.1872;
const FAR_LAT = 5.65;
const FAR_LON = -0.15;

function asUser<T>(fn: () => Promise<T>): Promise<T> {
  return TenantContextStore.run({ tenantId: TENANT_A, userId: HEADMASTER, roles: ['headmaster'], isPlatformUser: false }, fn);
}

function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('Transport (Chapter 28 FR-OPS-020)', () => {
  let pool: Pool;
  const routeIds: string[] = [];
  const stopIds: string[] = [];
  const vehicleIds: string[] = [];
  const driverIds: string[] = [];
  const studentIds: string[] = [];
  const assignmentIds: string[] = [];
  const guardianIds: string[] = [];
  const notificationIds: string[] = [];

  let cleanupPool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL });
    // transport_vehicle_locations/transport_stop_arrivals grant only
    // select+insert to pbsms_app (0035_transport_gps.sql — deliberately
    // append-only: a GPS ping log and an arrival-debounce log). Same gap
    // tenant-lifecycle.e2e-spec.ts hit for audit_log/platform_audit_logs —
    // teardown for those two tables needs the schema-owning role instead.
    cleanupPool = new Pool({ connectionString: process.env.MIGRATE_DATABASE_URL });
  });

  afterAll(async () => {
    const cleanup = new WorkerTenantConnection(pool);
    try {
      // Must run before transport_vehicles/transport_stops are deleted
      // below — both FK (tenant_id, vehicle_id)/(tenant_id, stop_id) to
      // them.
      await cleanupPool.query(`delete from transport_stop_arrivals where vehicle_id = any($1::uuid[])`, [vehicleIds]);
      await cleanupPool.query(`delete from transport_vehicle_locations where vehicle_id = any($1::uuid[])`, [vehicleIds]);
      await asUser(async () => {
        await cleanup.query(`delete from notification_deliveries where notification_id = any($1::uuid[])`, [notificationIds]);
        await cleanup.query(`delete from notifications where id = any($1::uuid[])`, [notificationIds]);
        await cleanup.query(`delete from transport_student_assignments where id = any($1::uuid[])`, [assignmentIds]);
        await cleanup.query(`delete from student_guardians where student_id = any($1::uuid[])`, [studentIds]);
        await cleanup.query(`delete from guardians where id = any($1::uuid[])`, [guardianIds]);
        await cleanup.query(`delete from transport_drivers where id = any($1::uuid[])`, [driverIds]);
        await cleanup.query(`delete from transport_vehicles where id = any($1::uuid[])`, [vehicleIds]);
        await cleanup.query(`delete from transport_stops where route_id = any($1::uuid[])`, [routeIds]);
        await cleanup.query(`delete from transport_routes where id = any($1::uuid[])`, [routeIds]);
        await cleanup.query(`delete from students where id = any($1::uuid[])`, [studentIds]);
      });
    } finally {
      cleanup.release();
      await cleanupPool.end();
      await pool.end();
    }
  }, 30000);

  function harness(): { conn: WorkerTenantConnection; service: TransportService } {
    const conn = new WorkerTenantConnection(pool);
    const guardians = new GuardiansService(conn);
    const communication = new CommunicationService(conn, new StaffService(conn), guardians);
    return { conn, service: new TransportService(conn, guardians, communication) };
  }

  async function createRouteWithStop(service: TransportService, geoLocated: boolean) {
    const route = await asUser(() => service.createRoute({ name: uniqueName('FR-OPS-020 Route') } as never));
    routeIds.push(route.id);
    const stop = await asUser(() => service.addStop(route.id, { name: 'Fixture Stop', sequenceNo: 1 } as never));
    stopIds.push(stop.id);
    if (geoLocated) {
      await asUser(() => service.setStopLocation(stop.id, { latitude: STOP_LAT, longitude: STOP_LON } as never));
    }
    return { route, stop };
  }

  async function createStudent(conn: WorkerTenantConnection): Promise<string> {
    const rows = await asUser(() =>
      conn.query<{ id: string }>(
        `insert into students (tenant_id, school_id, admission_no, first_name, last_name, created_by, updated_by)
         values (current_tenant_id(), $1, $2, 'FR-OPS', 'Fixture', $3, $3) returning id`,
        [SCHOOL_A, uniqueName('ADM'), HEADMASTER],
      ),
    );
    studentIds.push(rows[0].id);
    return rows[0].id;
  }

  describe('assignVehicleToRoute()/assignDriverToVehicle()', () => {
    it('links a vehicle to a route and a driver to that vehicle', async () => {
      const { conn, service } = harness();
      try {
        const { route } = await createRouteWithStop(service, false);
        const vehicle = await asUser(() =>
          service.createVehicle({ registrationNo: uniqueName('GT'), capacity: 20 } as never),
        );
        vehicleIds.push(vehicle.id);
        const linked = await asUser(() => service.assignVehicleToRoute(vehicle.id, route.id));
        expect(linked.route_id).toBe(route.id);

        const driver = await asUser(() =>
          service.createDriver({ name: 'Fixture Driver', licenseNo: uniqueName('LIC') } as never),
        );
        driverIds.push(driver.id);
        const assigned = await asUser(() => service.assignDriverToVehicle(driver.id, vehicle.id));
        expect(assigned.vehicle_id).toBe(vehicle.id);
      } finally {
        conn.release();
      }
    });
  });

  describe('assignStudentToRoute() — supersedes any prior active assignment', () => {
    it('ends the previous active assignment when a student is reassigned', async () => {
      const { conn, service } = harness();
      try {
        const first = await createRouteWithStop(service, false);
        const second = await createRouteWithStop(service, false);
        const studentId = await createStudent(conn);

        const firstAssignment = await asUser(() =>
          service.assignStudentToRoute({ studentId, routeId: first.route.id, stopId: first.stop.id } as never),
        );
        assignmentIds.push(firstAssignment.id);
        expect(firstAssignment.status).toBe('active');

        const secondAssignment = await asUser(() =>
          service.assignStudentToRoute({ studentId, routeId: second.route.id, stopId: second.stop.id } as never),
        );
        assignmentIds.push(secondAssignment.id);
        expect(secondAssignment.status).toBe('active');

        const firstAfter = await asUser(() =>
          conn.query<{ status: string }>(`select status from transport_student_assignments where id = $1`, [firstAssignment.id]),
        );
        expect(firstAfter[0].status).toBe('ended');
      } finally {
        conn.release();
      }
    });
  });

  describe('endAssignment()', () => {
    it('refuses to end an already-ended assignment, 404s on an unknown id', async () => {
      const { conn, service } = harness();
      try {
        const { route, stop } = await createRouteWithStop(service, false);
        const studentId = await createStudent(conn);
        const assignment = await asUser(() =>
          service.assignStudentToRoute({ studentId, routeId: route.id, stopId: stop.id } as never),
        );
        assignmentIds.push(assignment.id);

        const ended = await asUser(() => service.endAssignment(assignment.id));
        expect(ended.status).toBe('ended');

        await expect(asUser(() => service.endAssignment(assignment.id))).rejects.toThrow(/already 'ended'/);
        await expect(
          asUser(() => service.endAssignment('00000000-0000-0000-0000-000000000000')),
        ).rejects.toThrow(/not found/);
      } finally {
        conn.release();
      }
    });
  });

  describe('recordVehicleLocation() — GPS arrival pipeline', () => {
    it('notifies a linked guardian when the vehicle is within range of a geo-located stop assigned to their child', async () => {
      const { conn, service } = harness();
      try {
        const { route, stop } = await createRouteWithStop(service, true);
        const vehicle = await asUser(() =>
          service.createVehicle({ registrationNo: uniqueName('GT'), capacity: 20 } as never),
        );
        vehicleIds.push(vehicle.id);
        await asUser(() => service.assignVehicleToRoute(vehicle.id, route.id));

        const studentId = await createStudent(conn);
        const assignment = await asUser(() =>
          service.assignStudentToRoute({ studentId, routeId: route.id, stopId: stop.id } as never),
        );
        assignmentIds.push(assignment.id);

        const guardians = new GuardiansService(conn);
        const guardian = await asUser(() => guardians.create({ fullName: 'Fixture Guardian', phone: '+233241111111' }));
        guardianIds.push(guardian.id);
        await asUser(() => guardians.linkToStudent(studentId, { guardianId: guardian.id, isPrimaryContact: true }));

        const notificationsBefore = await asUser(() =>
          conn.query<{ id: string }>(`select id from notifications where recipient_id = $1`, [guardian.id]),
        );
        expect(notificationsBefore).toHaveLength(0);

        await asUser(() => service.recordVehicleLocation(vehicle.id, { latitude: NEAR_LAT, longitude: NEAR_LON } as never));

        const arrivals = await asUser(() =>
          conn.query<{ id: string }>(`select id from transport_stop_arrivals where vehicle_id = $1 and stop_id = $2`, [
            vehicle.id,
            stop.id,
          ]),
        );
        expect(arrivals).toHaveLength(1);

        const notificationsAfter = await asUser(() =>
          conn.query<{ id: string; body: string }>(`select id, body from notifications where recipient_id = $1`, [guardian.id]),
        );
        expect(notificationsAfter).toHaveLength(1);
        notificationIds.push(notificationsAfter[0].id);
        expect(notificationsAfter[0].body).toContain(stop.name);

        // A second near-ping within the cooldown window doesn't re-notify.
        await asUser(() => service.recordVehicleLocation(vehicle.id, { latitude: NEAR_LAT, longitude: NEAR_LON } as never));
        const arrivalsAfterSecondPing = await asUser(() =>
          conn.query<{ id: string }>(`select id from transport_stop_arrivals where vehicle_id = $1 and stop_id = $2`, [
            vehicle.id,
            stop.id,
          ]),
        );
        expect(arrivalsAfterSecondPing).toHaveLength(1);
      } finally {
        conn.release();
      }
    });

    it('does not create an arrival when the vehicle is far outside the threshold', async () => {
      const { conn, service } = harness();
      try {
        const { route, stop } = await createRouteWithStop(service, true);
        const vehicle = await asUser(() =>
          service.createVehicle({ registrationNo: uniqueName('GT'), capacity: 20 } as never),
        );
        vehicleIds.push(vehicle.id);
        await asUser(() => service.assignVehicleToRoute(vehicle.id, route.id));

        await asUser(() => service.recordVehicleLocation(vehicle.id, { latitude: FAR_LAT, longitude: FAR_LON } as never));

        const arrivals = await asUser(() =>
          conn.query<{ id: string }>(`select id from transport_stop_arrivals where vehicle_id = $1 and stop_id = $2`, [
            vehicle.id,
            stop.id,
          ]),
        );
        expect(arrivals).toHaveLength(0);
      } finally {
        conn.release();
      }
    });
  });
});
