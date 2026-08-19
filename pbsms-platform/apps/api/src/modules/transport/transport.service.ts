/**
 * transport.service.ts
 *
 * Implements SRS v2.1 Chapter 28 (FR-OPS-020). See 0013_transport.sql's
 * header for why GPS-based arrival notification isn't built.
 *
 * assignStudentToRoute() supersedes any existing active assignment for
 * the student in the same transaction it creates the new one — the same
 * "end the row this replaces, then insert" shape as
 * communication.service.ts's createTemplate().
 */

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { CreateRouteDto } from './dto/create-route.dto';
import { AddStopDto } from './dto/add-stop.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { CreateDriverDto } from './dto/create-driver.dto';
import { AssignStudentDto } from './dto/assign-student.dto';
import { SetStopLocationDto } from './dto/set-stop-location.dto';
import { RecordVehicleLocationDto } from './dto/record-vehicle-location.dto';
import { GuardiansService } from '../guardians/guardians.service';
import { CommunicationService } from '../communication/communication.service';

// FR-OPS-020's "GPS-based arrival notification" thresholds. No spec-given
// values exist for either — a school bus's own GPS accuracy is typically
// tens of meters, so 300m keeps false negatives (never firing) rarer than
// false positives (firing a stop early); 30 minutes keeps a vehicle
// dwelling near a stop (traffic, another stop 200m away) from re-notifying
// every single ping.
const ARRIVAL_THRESHOLD_METERS = 300;
const NOTIFICATION_COOLDOWN_MINUTES = 30;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface TransportRoute {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
}

export interface TransportStop {
  id: string;
  tenant_id: string;
  route_id: string;
  name: string;
  sequence_no: number;
  latitude: string | null;
  longitude: string | null;
}

export interface TransportVehicleLocation {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  latitude: string;
  longitude: string;
  recorded_at: string;
  reported_by: string;
}

export interface TransportVehicle {
  id: string;
  tenant_id: string;
  registration_no: string;
  capacity: number;
  route_id: string | null;
}

export interface TransportDriver {
  id: string;
  tenant_id: string;
  name: string;
  license_no: string;
  phone: string | null;
  vehicle_id: string | null;
}

export interface TransportStudentAssignment {
  id: string;
  tenant_id: string;
  student_id: string;
  route_id: string;
  stop_id: string;
  status: string;
  start_date: string;
  end_date: string | null;
}

@Injectable()
export class TransportService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly guardians: GuardiansService,
    private readonly communication: CommunicationService,
  ) {}

  // ---------------------------------------------------------------------
  // Routes & stops
  // ---------------------------------------------------------------------

  async createRoute(input: CreateRouteDto): Promise<TransportRoute> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<TransportRoute>(
      `insert into transport_routes (tenant_id, name, description, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $3)
       returning *`,
      [input.name, input.description ?? null, userId],
    );
    return rows[0];
  }

  async findAllRoutes(): Promise<TransportRoute[]> {
    return this.db.query<TransportRoute>(`select * from transport_routes order by name`);
  }

  async findRoute(id: string): Promise<TransportRoute> {
    const rows = await this.db.query<TransportRoute>(`select * from transport_routes where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Transport route ${id} not found`);
    }
    return rows[0];
  }

  async addStop(routeId: string, input: AddStopDto): Promise<TransportStop> {
    const { userId } = TenantContextStore.current();
    await this.findRoute(routeId);
    const rows = await this.db.query<TransportStop>(
      `insert into transport_stops (tenant_id, route_id, name, sequence_no, created_by)
       values (current_tenant_id(), $1, $2, $3, $4)
       returning *`,
      [routeId, input.name, input.sequenceNo, userId],
    );
    return rows[0];
  }

  async findStops(routeId: string): Promise<TransportStop[]> {
    return this.db.query<TransportStop>(`select * from transport_stops where route_id = $1 order by sequence_no`, [
      routeId,
    ]);
  }

  private async findStop(id: string): Promise<TransportStop> {
    const rows = await this.db.query<TransportStop>(`select * from transport_stops where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Transport stop ${id} not found`);
    }
    return rows[0];
  }

  async setStopLocation(stopId: string, input: SetStopLocationDto): Promise<TransportStop> {
    await this.findStop(stopId);
    const rows = await this.db.query<TransportStop>(
      `update transport_stops set latitude = $1, longitude = $2 where id = $3 returning *`,
      [input.latitude, input.longitude, stopId],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------
  // Vehicles & drivers
  // ---------------------------------------------------------------------

  async createVehicle(input: CreateVehicleDto): Promise<TransportVehicle> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<TransportVehicle>(
      `insert into transport_vehicles (tenant_id, registration_no, capacity, route_id, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $4)
       returning *`,
      [input.registrationNo, input.capacity, input.routeId ?? null, userId],
    );
    return rows[0];
  }

  async findAllVehicles(): Promise<TransportVehicle[]> {
    return this.db.query<TransportVehicle>(`select * from transport_vehicles order by registration_no`);
  }

  async findVehicle(id: string): Promise<TransportVehicle> {
    const rows = await this.db.query<TransportVehicle>(`select * from transport_vehicles where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Transport vehicle ${id} not found`);
    }
    return rows[0];
  }

  async assignVehicleToRoute(vehicleId: string, routeId: string): Promise<TransportVehicle> {
    const { userId } = TenantContextStore.current();
    await this.findVehicle(vehicleId);
    await this.findRoute(routeId);
    const rows = await this.db.query<TransportVehicle>(
      `update transport_vehicles set route_id = $1, updated_at = now(), updated_by = $2 where id = $3 returning *`,
      [routeId, userId, vehicleId],
    );
    return rows[0];
  }

  async createDriver(input: CreateDriverDto): Promise<TransportDriver> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<TransportDriver>(
      `insert into transport_drivers (tenant_id, name, license_no, phone, vehicle_id, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $5)
       returning *`,
      [input.name, input.licenseNo, input.phone ?? null, input.vehicleId ?? null, userId],
    );
    return rows[0];
  }

  async findAllDrivers(): Promise<TransportDriver[]> {
    return this.db.query<TransportDriver>(`select * from transport_drivers order by name`);
  }

  async findDriver(id: string): Promise<TransportDriver> {
    const rows = await this.db.query<TransportDriver>(`select * from transport_drivers where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Transport driver ${id} not found`);
    }
    return rows[0];
  }

  async assignDriverToVehicle(driverId: string, vehicleId: string): Promise<TransportDriver> {
    const { userId } = TenantContextStore.current();
    await this.findDriver(driverId);
    await this.findVehicle(vehicleId);
    const rows = await this.db.query<TransportDriver>(
      `update transport_drivers set vehicle_id = $1, updated_at = now(), updated_by = $2 where id = $3 returning *`,
      [vehicleId, userId, driverId],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------
  // Student-route assignment (FR-OPS-020)
  // ---------------------------------------------------------------------

  async assignStudentToRoute(input: AssignStudentDto): Promise<TransportStudentAssignment> {
    const { userId } = TenantContextStore.current();
    await this.db.query('BEGIN');
    try {
      await this.db.query(
        `update transport_student_assignments
         set status = 'ended', end_date = current_date, updated_at = now(), updated_by = $1
         where student_id = $2 and status = 'active'`,
        [userId, input.studentId],
      );
      const rows = await this.db.query<TransportStudentAssignment>(
        `insert into transport_student_assignments (tenant_id, student_id, route_id, stop_id, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4)
         returning *`,
        [input.studentId, input.routeId, input.stopId, userId],
      );
      await this.db.query('COMMIT');
      return rows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  async findAllAssignments(): Promise<TransportStudentAssignment[]> {
    return this.db.query<TransportStudentAssignment>(
      `select * from transport_student_assignments order by created_at desc`,
    );
  }

  async endAssignment(id: string): Promise<TransportStudentAssignment> {
    const { userId } = TenantContextStore.current();
    const rows0 = await this.db.query<TransportStudentAssignment>(
      `select * from transport_student_assignments where id = $1`,
      [id],
    );
    if (rows0.length === 0) {
      throw new NotFoundException(`Transport student assignment ${id} not found`);
    }
    if (rows0[0].status !== 'active') {
      throw new ConflictException(`Cannot end assignment ${id}: it is already '${rows0[0].status}'`);
    }
    const rows = await this.db.query<TransportStudentAssignment>(
      `update transport_student_assignments
       set status = 'ended', end_date = current_date, updated_at = now(), updated_by = $1
       where id = $2
       returning *`,
      [userId, id],
    );
    return rows[0];
  }

  // ---------------------------------------------------------------------
  // GPS-based arrival notification (FR-OPS-020, 0035_transport_gps.sql).
  // No device/vendor integration exists — recordVehicleLocation() is the
  // real seam any GPS device or driver-facing app would call; today it's
  // called with manually-entered coordinates the same way payments are
  // manually recorded rather than arriving via a provider webhook.
  // ---------------------------------------------------------------------

  async recordVehicleLocation(vehicleId: string, input: RecordVehicleLocationDto): Promise<TransportVehicleLocation> {
    const { userId } = TenantContextStore.current();
    const vehicle = await this.findVehicle(vehicleId);
    const rows = await this.db.query<TransportVehicleLocation>(
      `insert into transport_vehicle_locations (tenant_id, vehicle_id, latitude, longitude, reported_by)
       values (current_tenant_id(), $1, $2, $3, $4)
       returning *`,
      [vehicleId, input.latitude, input.longitude, userId],
    );
    const location = rows[0];

    if (vehicle.route_id) {
      await this.checkArrivals(vehicle, location);
    }
    return location;
  }

  async findVehicleLocations(vehicleId: string, limit = 50): Promise<TransportVehicleLocation[]> {
    await this.findVehicle(vehicleId);
    return this.db.query<TransportVehicleLocation>(
      `select * from transport_vehicle_locations where vehicle_id = $1 order by recorded_at desc limit $2`,
      [vehicleId, limit],
    );
  }

  /** Checks every geo-located stop on the vehicle's route against the just-
   * recorded position; a stop within ARRIVAL_THRESHOLD_METERS that hasn't
   * already notified within NOTIFICATION_COOLDOWN_MINUTES gets a fresh
   * transport_stop_arrivals row and a real notification to every guardian
   * of every student assigned to that stop. One bad recipient must not
   * block the rest — same per-item isolation mass-notification.handler.ts
   * uses for the same reason. */
  private async checkArrivals(vehicle: TransportVehicle, location: TransportVehicleLocation): Promise<void> {
    const stops = await this.db.query<TransportStop>(
      `select * from transport_stops where route_id = $1 and latitude is not null and longitude is not null`,
      [vehicle.route_id],
    );
    for (const stop of stops) {
      const distance = haversineMeters(Number(location.latitude), Number(location.longitude), Number(stop.latitude), Number(stop.longitude));
      if (distance > ARRIVAL_THRESHOLD_METERS) continue;

      const recentArrival = await this.db.query<{ id: string }>(
        `select id from transport_stop_arrivals
         where vehicle_id = $1 and stop_id = $2 and notified_at > now() - interval '${NOTIFICATION_COOLDOWN_MINUTES} minutes'
         limit 1`,
        [vehicle.id, stop.id],
      );
      if (recentArrival.length > 0) continue;

      await this.db.query(
        `insert into transport_stop_arrivals (tenant_id, vehicle_id, stop_id) values (current_tenant_id(), $1, $2)`,
        [vehicle.id, stop.id],
      );
      await this.notifyGuardiansOfArrival(stop, vehicle);
    }
  }

  private async notifyGuardiansOfArrival(stop: TransportStop, vehicle: TransportVehicle): Promise<void> {
    const assignments = await this.db.query<{ student_id: string }>(
      `select student_id from transport_student_assignments where stop_id = $1 and status = 'active'`,
      [stop.id],
    );
    const seenGuardians = new Set<string>();
    for (const { student_id } of assignments) {
      let links;
      try {
        links = await this.guardians.findForStudent(student_id);
      } catch {
        continue; // one student's link lookup failing must not block the rest
      }
      for (const link of links) {
        if (seenGuardians.has(link.guardian_id)) continue;
        seenGuardians.add(link.guardian_id);
        try {
          const notification = await this.communication.createNotification({
            recipientType: 'guardian',
            recipientId: link.guardian_id,
            recipientName: link.full_name,
            recipientPhone: link.phone ?? undefined,
            recipientEmail: link.email ?? undefined,
            subject: 'Bus arriving',
            body: `The bus for route "${vehicle.registration_no}" is now near ${stop.name}.`,
            sensitivityLevel: 'normal',
            isUrgent: true,
          });
          await this.communication.send(notification.id);
        } catch {
          continue; // one failed dispatch must not block the rest
        }
      }
    }
  }
}
