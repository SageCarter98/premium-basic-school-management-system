import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TransportService } from './transport.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { AddStopDto } from './dto/add-stop.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { CreateDriverDto } from './dto/create-driver.dto';
import { AssignStudentDto } from './dto/assign-student.dto';
import { SetStopLocationDto } from './dto/set-stop-location.dto';
import { RecordVehicleLocationDto } from './dto/record-vehicle-location.dto';
import { Roles } from '../../common/auth/roles.decorator';
import { TRANSPORT_TEAM } from '../../common/auth/role-groups';

/** transport.controller.ts — SRS Chapter 28 (FR-OPS-020). TRANSPORT_TEAM
 * (LEADERSHIP + 'transport_officer') for every endpoint — same
 * least-privilege default as library.controller.ts. */
@Controller('v1/transport')
export class TransportController {
  constructor(private readonly transport: TransportService) {}

  @Roles(...TRANSPORT_TEAM)
  @Post('routes')
  createRoute(@Body() body: CreateRouteDto) {
    return this.transport.createRoute(body);
  }

  @Roles(...TRANSPORT_TEAM)
  @Get('routes')
  findAllRoutes() {
    return this.transport.findAllRoutes();
  }

  @Roles(...TRANSPORT_TEAM)
  @Get('routes/:id')
  findRoute(@Param('id') id: string) {
    return this.transport.findRoute(id);
  }

  @Roles(...TRANSPORT_TEAM)
  @Post('routes/:id/stops')
  addStop(@Param('id') id: string, @Body() body: AddStopDto) {
    return this.transport.addStop(id, body);
  }

  @Roles(...TRANSPORT_TEAM)
  @Get('routes/:id/stops')
  findStops(@Param('id') id: string) {
    return this.transport.findStops(id);
  }

  @Roles(...TRANSPORT_TEAM)
  @Post('stops/:id/location')
  setStopLocation(@Param('id') id: string, @Body() body: SetStopLocationDto) {
    return this.transport.setStopLocation(id, body);
  }

  @Roles(...TRANSPORT_TEAM)
  @Post('vehicles')
  createVehicle(@Body() body: CreateVehicleDto) {
    return this.transport.createVehicle(body);
  }

  @Roles(...TRANSPORT_TEAM)
  @Get('vehicles')
  findAllVehicles() {
    return this.transport.findAllVehicles();
  }

  @Roles(...TRANSPORT_TEAM)
  @Get('vehicles/:id')
  findVehicle(@Param('id') id: string) {
    return this.transport.findVehicle(id);
  }

  @Roles(...TRANSPORT_TEAM)
  @Post('vehicles/:id/assign-route/:routeId')
  assignVehicleToRoute(@Param('id') id: string, @Param('routeId') routeId: string) {
    return this.transport.assignVehicleToRoute(id, routeId);
  }

  @Roles(...TRANSPORT_TEAM)
  @Post('vehicles/:id/locations')
  recordVehicleLocation(@Param('id') id: string, @Body() body: RecordVehicleLocationDto) {
    return this.transport.recordVehicleLocation(id, body);
  }

  @Roles(...TRANSPORT_TEAM)
  @Get('vehicles/:id/locations')
  findVehicleLocations(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.transport.findVehicleLocations(id, limit ? Number(limit) : undefined);
  }

  @Roles(...TRANSPORT_TEAM)
  @Post('drivers')
  createDriver(@Body() body: CreateDriverDto) {
    return this.transport.createDriver(body);
  }

  @Roles(...TRANSPORT_TEAM)
  @Get('drivers')
  findAllDrivers() {
    return this.transport.findAllDrivers();
  }

  @Roles(...TRANSPORT_TEAM)
  @Get('drivers/:id')
  findDriver(@Param('id') id: string) {
    return this.transport.findDriver(id);
  }

  @Roles(...TRANSPORT_TEAM)
  @Post('drivers/:id/assign-vehicle/:vehicleId')
  assignDriverToVehicle(@Param('id') id: string, @Param('vehicleId') vehicleId: string) {
    return this.transport.assignDriverToVehicle(id, vehicleId);
  }

  @Roles(...TRANSPORT_TEAM)
  @Post('assignments')
  assignStudentToRoute(@Body() body: AssignStudentDto) {
    return this.transport.assignStudentToRoute(body);
  }

  @Roles(...TRANSPORT_TEAM)
  @Get('assignments')
  findAllAssignments() {
    return this.transport.findAllAssignments();
  }

  @Roles(...TRANSPORT_TEAM)
  @Post('assignments/:id/end')
  endAssignment(@Param('id') id: string) {
    return this.transport.endAssignment(id);
  }
}
