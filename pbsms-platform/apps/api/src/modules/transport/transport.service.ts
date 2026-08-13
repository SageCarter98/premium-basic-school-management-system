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
  constructor(private readonly db: TenantDatabaseService) {}

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
}
