'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/Card/Card';
import { Button } from '@/components/Button/Button';
import { Pill } from '@/components/Pill/Pill';
import { LoadingState } from '@/components/states/LoadingState';
import { ErrorState } from '@/components/states/ErrorState';
import { EmptyState } from '@/components/states/EmptyState';
import { RestrictedState } from '@/components/states/RestrictedState';
import { apiFetch, apiGet } from '@/lib/api-client';
import { decodeAccessToken } from '@/lib/auth-token-store';
import { TRANSPORT_TEAM, hasAnyRole } from '@/lib/role-groups';
import styles from '@/styles/tab-hub.module.css';

interface Student {
  id: string;
  first_name: string;
  last_name: string;
}
interface TransportRoute {
  id: string;
  name: string;
  description: string | null;
}
interface TransportStop {
  id: string;
  route_id: string;
  name: string;
  sequence_no: number;
  latitude: string | null;
  longitude: string | null;
}
interface TransportVehicleLocation {
  id: string;
  vehicle_id: string;
  latitude: string;
  longitude: string;
  recorded_at: string;
  reported_by: string;
}
interface TransportVehicle {
  id: string;
  registration_no: string;
  capacity: number;
  route_id: string | null;
}
interface TransportDriver {
  id: string;
  name: string;
  license_no: string;
  phone: string | null;
  vehicle_id: string | null;
}
interface TransportStudentAssignment {
  id: string;
  student_id: string;
  route_id: string;
  stop_id: string;
  status: string;
  start_date: string;
  end_date: string | null;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
  const m = body?.message;
  return (Array.isArray(m) ? m.join('; ') : m) ?? fallback;
}

function studentName(students: Student[], id: string): string {
  const s = students.find((st) => st.id === id);
  return s ? `${s.last_name}, ${s.first_name}` : id.slice(0, 8) + '…';
}

const TABS = ['Routes & Stops', 'Vehicles & Drivers', 'Student Assignments', 'Live Tracking'] as const;
type Tab = (typeof TABS)[number];

/** SRS Chapter 28 (spec §7.13 "Transport — routes, stops, vehicles,
 * assignments"). GPS-based arrival notification (0035_transport_gps.sql)
 * has no real device/vendor integration — Live Tracking posts
 * manually-entered coordinates through the same endpoint a real GPS
 * device or driver app would call, same "seam is real, wiring is later"
 * pattern the Reconciliation Workspace uses for provider settlement data. */
export default function TransportPage() {
  const [tab, setTab] = useState<Tab>('Routes & Stops');
  const roleCodes = decodeAccessToken()?.roleCodes ?? [];
  const canAccess = hasAnyRole(roleCodes, TRANSPORT_TEAM);

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [routes, setRoutes] = useState<TransportRoute[]>([]);
  const [vehicles, setVehicles] = useState<TransportVehicle[]>([]);
  const [drivers, setDrivers] = useState<TransportDriver[]>([]);

  function reloadShared() {
    return Promise.all([
      apiGet<Student[]>('/v1/students'),
      apiGet<TransportRoute[]>('/v1/transport/routes'),
      apiGet<TransportVehicle[]>('/v1/transport/vehicles'),
      apiGet<TransportDriver[]>('/v1/transport/drivers'),
    ]).then(([s, r, v, d]) => {
      setStudents(s);
      setRoutes(r);
      setVehicles(v);
      setDrivers(d);
    });
  }

  useEffect(() => {
    if (!canAccess) {
      setLoading(false);
      return;
    }
    reloadShared().finally(() => setLoading(false));
  }, [canAccess]);

  if (!canAccess) {
    return (
      <Card>
        <RestrictedState message="Transport is available to the transport officer and leadership roles only." />
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading transport" rows={4} />
      </Card>
    );
  }

  return (
    <div>
      <div className={styles.tabBar} role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={[styles.tabBtn, tab === t ? styles.tabBtnActive : ''].filter(Boolean).join(' ')} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <Card style={{ padding: 'var(--pb-space-4)' }}>
        {tab === 'Routes & Stops' && <RoutesTab routes={routes} onChanged={reloadShared} />}
        {tab === 'Vehicles & Drivers' && <VehiclesDriversTab routes={routes} vehicles={vehicles} drivers={drivers} onChanged={reloadShared} />}
        {tab === 'Student Assignments' && <AssignmentsTab students={students} routes={routes} />}
        {tab === 'Live Tracking' && <LiveTrackingTab vehicles={vehicles} />}
      </Card>
    </div>
  );
}

function RoutesTab({ routes, onChanged }: { routes: TransportRoute[]; onChanged: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stops, setStops] = useState<TransportStop[]>([]);
  const [stopForm, setStopForm] = useState({ name: '', sequenceNo: '1' });
  const [locationForm, setLocationForm] = useState<Record<string, { latitude: string; longitude: string }>>({});

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch('/v1/transport/routes', { method: 'POST', body: JSON.stringify({ name: form.name, description: form.description || undefined }) });
      if (!res.ok) throw new Error(await errorMessage(res, `Failed (${res.status})`));
      setForm({ name: '', description: '' });
      setShowCreate(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create route.');
    } finally {
      setSaving(false);
    }
  }

  async function expand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setStops(await apiGet<TransportStop[]>(`/v1/transport/routes/${id}/stops`));
  }

  async function addStop(routeId: string) {
    setError(null);
    const res = await apiFetch(`/v1/transport/routes/${routeId}/stops`, { method: 'POST', body: JSON.stringify({ name: stopForm.name, sequenceNo: Number(stopForm.sequenceNo) }) });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setStopForm({ name: '', sequenceNo: String(Number(stopForm.sequenceNo) + 1) });
    setStops(await apiGet<TransportStop[]>(`/v1/transport/routes/${routeId}/stops`));
  }

  async function saveStopLocation(routeId: string, stopId: string) {
    setError(null);
    const f = locationForm[stopId];
    if (!f?.latitude || !f?.longitude) return;
    const res = await apiFetch(`/v1/transport/stops/${stopId}/location`, {
      method: 'POST',
      body: JSON.stringify({ latitude: Number(f.latitude), longitude: Number(f.longitude) }),
    });
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setStops(await apiGet<TransportStop[]>(`/v1/transport/routes/${routeId}/stops`));
  }

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showCreate ? 'Cancel' : 'Add route'}
      </Button>
      {showCreate && (
        <div className={styles.formRow}>
          <input className={styles.textInput} placeholder="Route name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={styles.textInput} placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Button type="button" onClick={handleCreate} disabled={saving || !form.name}>
            Save
          </Button>
        </div>
      )}
      {error && <ErrorState message={error} />}
      {routes.length === 0 ? (
        <EmptyState title="No routes yet" message="Add one, then add stops before assigning vehicles or students." />
      ) : (
        routes.map((r) => (
          <div key={r.id}>
            <div className={styles.listRow} style={{ cursor: 'pointer' }} onClick={() => expand(r.id)}>
              <span>
                {r.name}
                {r.description && <> — {r.description}</>}
              </span>
            </div>
            {expandedId === r.id && (
              <div className={styles.detailPanel}>
                {stops.length === 0 ? (
                  <EmptyState title="No stops yet" message="Add the first stop below." />
                ) : (
                  stops
                    .slice()
                    .sort((a, b) => a.sequence_no - b.sequence_no)
                    .map((s) => (
                      <div key={s.id}>
                        <div className={styles.listRow}>
                          <span>#{s.sequence_no} {s.name}</span>
                          {s.latitude && s.longitude ? (
                            <Pill variant="success">
                              {Number(s.latitude).toFixed(4)}, {Number(s.longitude).toFixed(4)}
                            </Pill>
                          ) : (
                            <Pill variant="neutral">no location</Pill>
                          )}
                        </div>
                        <div className={styles.formRow}>
                          <input
                            aria-label={`${s.name} latitude`}
                            className={styles.textInput}
                            type="number"
                            step="0.000001"
                            placeholder="Latitude"
                            value={locationForm[s.id]?.latitude ?? ''}
                            onChange={(e) => setLocationForm({ ...locationForm, [s.id]: { ...locationForm[s.id], latitude: e.target.value, longitude: locationForm[s.id]?.longitude ?? '' } })}
                          />
                          <input
                            aria-label={`${s.name} longitude`}
                            className={styles.textInput}
                            type="number"
                            step="0.000001"
                            placeholder="Longitude"
                            value={locationForm[s.id]?.longitude ?? ''}
                            onChange={(e) => setLocationForm({ ...locationForm, [s.id]: { ...locationForm[s.id], longitude: e.target.value, latitude: locationForm[s.id]?.latitude ?? '' } })}
                          />
                          <Button type="button" variant="secondary" onClick={() => saveStopLocation(r.id, s.id)} disabled={!locationForm[s.id]?.latitude || !locationForm[s.id]?.longitude}>
                            {s.latitude ? 'Update location' : 'Set location'}
                          </Button>
                        </div>
                      </div>
                    ))
                )}
                <div className={styles.formRow}>
                  <input className={styles.textInput} type="number" min="1" style={{ maxWidth: 80 }} placeholder="Seq" value={stopForm.sequenceNo} onChange={(e) => setStopForm({ ...stopForm, sequenceNo: e.target.value })} />
                  <input className={styles.textInput} placeholder="Stop name" value={stopForm.name} onChange={(e) => setStopForm({ ...stopForm, name: e.target.value })} />
                  <Button type="button" variant="secondary" onClick={() => addStop(r.id)} disabled={!stopForm.name}>
                    Add stop
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function VehiclesDriversTab({
  routes,
  vehicles,
  drivers,
  onChanged,
}: {
  routes: TransportRoute[];
  vehicles: TransportVehicle[];
  drivers: TransportDriver[];
  onChanged: () => void;
}) {
  const [vForm, setVForm] = useState({ registrationNo: '', capacity: '20' });
  const [dForm, setDForm] = useState({ name: '', licenseNo: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addVehicle() {
    setBusy(true);
    setError(null);
    const res = await apiFetch('/v1/transport/vehicles', { method: 'POST', body: JSON.stringify({ registrationNo: vForm.registrationNo, capacity: Number(vForm.capacity) }) });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setVForm({ registrationNo: '', capacity: '20' });
    onChanged();
  }

  async function addDriver() {
    setBusy(true);
    setError(null);
    const res = await apiFetch('/v1/transport/drivers', { method: 'POST', body: JSON.stringify({ name: dForm.name, licenseNo: dForm.licenseNo, phone: dForm.phone || undefined }) });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setDForm({ name: '', licenseNo: '', phone: '' });
    onChanged();
  }

  async function assignVehicleRoute(vehicleId: string, routeId: string) {
    if (!routeId) return;
    setBusy(true);
    await apiFetch(`/v1/transport/vehicles/${vehicleId}/assign-route/${routeId}`, { method: 'POST' });
    setBusy(false);
    onChanged();
  }

  async function assignDriverVehicle(driverId: string, vehicleId: string) {
    if (!vehicleId) return;
    setBusy(true);
    await apiFetch(`/v1/transport/drivers/${driverId}/assign-vehicle/${vehicleId}`, { method: 'POST' });
    setBusy(false);
    onChanged();
  }

  return (
    <div>
      {error && <ErrorState message={error} />}
      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Vehicles</div>
        <div className={styles.formRow}>
          <input className={styles.textInput} placeholder="Registration no." value={vForm.registrationNo} onChange={(e) => setVForm({ ...vForm, registrationNo: e.target.value })} />
          <input className={styles.textInput} type="number" min="1" placeholder="Capacity" value={vForm.capacity} onChange={(e) => setVForm({ ...vForm, capacity: e.target.value })} />
          <Button type="button" variant="secondary" onClick={addVehicle} disabled={busy || !vForm.registrationNo}>
            Add vehicle
          </Button>
        </div>
        {vehicles.length === 0 ? (
          <EmptyState title="No vehicles yet" message="Add one before assigning a route." />
        ) : (
          vehicles.map((v) => (
            <div key={v.id} className={styles.listRow}>
              <span>
                {v.registration_no} — capacity {v.capacity}
              </span>
              <select className={styles.select} style={{ maxWidth: 200 }} value={v.route_id ?? ''} onChange={(e) => assignVehicleRoute(v.id, e.target.value)}>
                <option value="">No route assigned</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          ))
        )}
      </div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Drivers</div>
        <div className={styles.formRow}>
          <input className={styles.textInput} placeholder="Name" value={dForm.name} onChange={(e) => setDForm({ ...dForm, name: e.target.value })} />
          <input className={styles.textInput} placeholder="License no." value={dForm.licenseNo} onChange={(e) => setDForm({ ...dForm, licenseNo: e.target.value })} />
          <input className={styles.textInput} placeholder="Phone (optional)" value={dForm.phone} onChange={(e) => setDForm({ ...dForm, phone: e.target.value })} />
          <Button type="button" variant="secondary" onClick={addDriver} disabled={busy || !dForm.name || !dForm.licenseNo}>
            Add driver
          </Button>
        </div>
        {drivers.length === 0 ? (
          <EmptyState title="No drivers yet" message="Add one before assigning a vehicle." />
        ) : (
          drivers.map((d) => (
            <div key={d.id} className={styles.listRow}>
              <span>
                {d.name} — {d.license_no}
              </span>
              <select className={styles.select} style={{ maxWidth: 200 }} value={d.vehicle_id ?? ''} onChange={(e) => assignDriverVehicle(d.id, e.target.value)}>
                <option value="">No vehicle assigned</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration_no}
                  </option>
                ))}
              </select>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AssignmentsTab({ students, routes }: { students: Student[]; routes: TransportRoute[] }) {
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<TransportStudentAssignment[]>([]);
  const [stopsByRoute, setStopsByRoute] = useState<Record<string, TransportStop[]>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ studentId: '', routeId: '', stopId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    setLoading(true);
    apiGet<TransportStudentAssignment[]>('/v1/transport/assignments')
      .then(setAssignments)
      .finally(() => setLoading(false));
  }
  useEffect(reload, []);

  async function pickRoute(routeId: string) {
    setForm({ ...form, routeId, stopId: '' });
    if (routeId && !stopsByRoute[routeId]) {
      const stops = await apiGet<TransportStop[]>(`/v1/transport/routes/${routeId}/stops`);
      setStopsByRoute((s) => ({ ...s, [routeId]: stops }));
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    const res = await apiFetch('/v1/transport/assignments', { method: 'POST', body: JSON.stringify(form) });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setForm({ studentId: '', routeId: '', stopId: '' });
    setShowCreate(false);
    reload();
  }

  async function end(id: string) {
    setBusy(true);
    await apiFetch(`/v1/transport/assignments/${id}/end`, { method: 'POST' });
    setBusy(false);
    reload();
  }

  if (loading) return <LoadingState label="Loading assignments" rows={3} />;

  return (
    <div>
      <Button type="button" variant="secondary" onClick={() => setShowCreate((v) => !v)} style={{ marginBottom: 'var(--pb-space-3)' }}>
        {showCreate ? 'Cancel' : 'Assign student'}
      </Button>
      {showCreate && (
        <div className={styles.formRow}>
          <select className={styles.select} value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })}>
            <option value="">Choose a student</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.last_name}, {s.first_name}
              </option>
            ))}
          </select>
          <select className={styles.select} value={form.routeId} onChange={(e) => pickRoute(e.target.value)}>
            <option value="">Choose a route</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <select className={styles.select} value={form.stopId} onChange={(e) => setForm({ ...form, stopId: e.target.value })} disabled={!form.routeId}>
            <option value="">Choose a stop</option>
            {(stopsByRoute[form.routeId] ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button type="button" onClick={create} disabled={busy || !form.studentId || !form.routeId || !form.stopId}>
            Save
          </Button>
        </div>
      )}
      <p className={styles.hint}>Assigning a student to a new route automatically ends their previous active assignment.</p>
      {error && <ErrorState message={error} />}
      {assignments.length === 0 ? (
        <EmptyState title="No assignments yet" message="Assign a student to a route and stop." />
      ) : (
        assignments.map((a) => (
          <div key={a.id} className={styles.listRow}>
            <span>
              {studentName(students, a.student_id)} — {routes.find((r) => r.id === a.route_id)?.name ?? a.route_id}
            </span>
            <span style={{ display: 'flex', gap: 'var(--pb-space-2)', alignItems: 'center' }}>
              <Pill variant={a.status === 'active' ? 'success' : 'neutral'}>{a.status}</Pill>
              {a.status === 'active' && (
                <Button type="button" variant="secondary" onClick={() => end(a.id)} disabled={busy}>
                  End
                </Button>
              )}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function LiveTrackingTab({ vehicles }: { vehicles: TransportVehicle[] }) {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '');
  const [form, setForm] = useState({ latitude: '', longitude: '' });
  const [locations, setLocations] = useState<TransportVehicleLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function reload(id: string) {
    if (!id) return;
    setLoading(true);
    apiGet<TransportVehicleLocation[]>(`/v1/transport/vehicles/${id}/locations`)
      .then(setLocations)
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    reload(vehicleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  async function recordLocation() {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await apiFetch(`/v1/transport/vehicles/${vehicleId}/locations`, {
      method: 'POST',
      body: JSON.stringify({ latitude: Number(form.latitude), longitude: Number(form.longitude) }),
    });
    setBusy(false);
    if (!res.ok) return setError(await errorMessage(res, `Failed (${res.status})`));
    setResult('Location recorded. Guardians of any students at a stop within range are notified automatically.');
    setForm({ latitude: '', longitude: '' });
    reload(vehicleId);
  }

  if (vehicles.length === 0) {
    return <EmptyState title="No vehicles yet" message="Add a vehicle on the Vehicles & Drivers tab first." />;
  }

  return (
    <div>
      <p className={styles.hint}>
        No real GPS device is connected in this environment — this posts a manually-entered position through the same endpoint a driver&apos;s phone or a real GPS unit would call. Guardians of
        students assigned to a geo-located stop within 300m are notified automatically, at most once every 30 minutes per stop.
      </p>
      <div className={styles.formRow}>
        <select aria-label="Vehicle" className={styles.select} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.registration_no}
            </option>
          ))}
        </select>
        <input aria-label="Latitude" className={styles.textInput} type="number" step="0.000001" placeholder="Latitude" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
        <input aria-label="Longitude" className={styles.textInput} type="number" step="0.000001" placeholder="Longitude" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
        <Button type="button" onClick={recordLocation} disabled={busy || !vehicleId || !form.latitude || !form.longitude}>
          Record location
        </Button>
      </div>
      {error && <ErrorState message={error} />}
      {result && <p className={styles.hint}>{result}</p>}

      <p className={styles.hint} style={{ marginTop: 'var(--pb-space-3)' }}>
        Recent positions
      </p>
      {loading ? (
        <LoadingState label="Loading positions" rows={3} />
      ) : locations.length === 0 ? (
        <EmptyState title="No positions recorded yet" message="Record one above." />
      ) : (
        locations.map((loc) => (
          <div key={loc.id} className={styles.listRow}>
            <span>
              {Number(loc.latitude).toFixed(6)}, {Number(loc.longitude).toFixed(6)}
            </span>
            <span className={styles.hint}>{new Date(loc.recorded_at).toLocaleString()}</span>
          </div>
        ))
      )}
    </div>
  );
}
