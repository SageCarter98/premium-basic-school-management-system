/**
 * offline-db.ts
 *
 * Stage 3's storage layer (spec §9.1/§9.2). Hand-rolled on the raw
 * IndexedDB API — no new npm dependency, same call the codebase already
 * made for TOTP (apps/api/src/common/auth/totp.ts) rather than pulling in
 * a library for something this small.
 *
 * One database PER TENANT (`pbsms-offline-<tenantId>`) — spec §9.1's
 * "Cache is tenant-namespaced (TEN-040) and cleared on logout" — so a
 * device that's ever been used for two different tenants can never surface
 * one tenant's cached roster while signed into another. `clearOfflineDb()`
 * is called from auth-token-store.ts's `clearTokens()`.
 *
 * Four object stores:
 * - `pending_attendance` — the offline write queue (spec §9.1 "Capture").
 *   keyPath `clientId`, the same id attendance.service.ts's sync() uses for
 *   idempotent replay — generated once, client-side, when a mark is made.
 * - `pending_scores` — Stage 4's score-entry queue (spec §8.11). Unlike
 *   attendance, `/v1/assessment/components/:id/scores` has no batch or
 *   clientId-idempotency support server-side (NFR-PERF-030's optimistic
 *   locking is per-score, one at a time) — `clientId` here is this app's
 *   OWN bookkeeping key for the queue row/SyncLedger identity, not
 *   something the backend consumes.
 * - `roster_cache` — pre-fetched read data (classes/students/enrolments/
 *   teacher-assignments/academic-years/assessment structures & scores),
 *   spec §9.1 "Pre-fetch". Keyed by a caller-chosen string so different
 *   screens can cache different slices.
 * - `auth_mirror` — a copy of the Bearer tokens auth-token-store.ts keeps
 *   in localStorage. A service worker cannot read localStorage (it isn't a
 *   window), but it CAN read IndexedDB — this mirror is what lets sw.js's
 *   'sync' handler authenticate a background flush of the queue without
 *   the page being open. Written by auth-token-store.ts, never by this
 *   module's own callers.
 */

export interface PendingAttendanceEntry {
  clientId: string;
  studentId: string;
  classId: string;
  attendanceDate: string;
  session?: string;
  status: string;
  deviceTimestamp: string;
  syncState: 'pending' | 'sending' | 'sent' | 'failed';
  failReason?: string;
  conflictId?: string;
  queuedAt: string;
}

export interface PendingScoreEntry {
  clientId: string;
  componentId: string;
  studentId: string;
  status: 'scored' | 'missing';
  value?: number;
  missingReason?: string;
  /** The version last seen for this student+component at queue time —
   * undefined only when no score existed yet (a genuine first entry), per
   * upsert-score.dto.ts's own contract. */
  expectedVersion?: number;
  syncState: 'pending' | 'sending' | 'sent' | 'failed';
  failReason?: string;
  queuedAt: string;
}

const DB_VERSION = 2; // bumped for Stage 4's pending_scores store
const STORE_QUEUE = 'pending_attendance';
const STORE_SCORE_QUEUE = 'pending_scores';
const STORE_ROSTER = 'roster_cache';
const STORE_AUTH = 'auth_mirror';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

function dbName(tenantId: string): string {
  return `pbsms-offline-${tenantId}`;
}

// One open connection per tenant, reused across calls in the same page
// session rather than re-opening on every read/write.
const openDbs = new Map<string, Promise<IDBDatabase>>();

function openDb(tenantId: string): Promise<IDBDatabase> {
  const existing = openDbs.get(tenantId);
  if (existing) return existing;

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName(tenantId), DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'clientId' });
      }
      if (!db.objectStoreNames.contains(STORE_SCORE_QUEUE)) {
        db.createObjectStore(STORE_SCORE_QUEUE, { keyPath: 'clientId' });
      }
      if (!db.objectStoreNames.contains(STORE_ROSTER)) {
        db.createObjectStore(STORE_ROSTER, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_AUTH)) {
        db.createObjectStore(STORE_AUTH, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  openDbs.set(tenantId, promise);
  return promise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueAttendanceEntries(
  tenantId: string,
  entries: PendingAttendanceEntry[],
): Promise<void> {
  if (!isBrowser() || entries.length === 0) return;
  const db = await openDb(tenantId);
  const tx = db.transaction(STORE_QUEUE, 'readwrite');
  const store = tx.objectStore(STORE_QUEUE);
  for (const entry of entries) store.put(entry);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getQueuedAttendanceEntries(tenantId: string): Promise<PendingAttendanceEntry[]> {
  if (!isBrowser()) return [];
  const db = await openDb(tenantId);
  const tx = db.transaction(STORE_QUEUE, 'readonly');
  const entries = await requestToPromise(tx.objectStore(STORE_QUEUE).getAll());
  return entries as PendingAttendanceEntry[];
}

export async function updateQueuedEntryState(
  tenantId: string,
  clientId: string,
  patch: Partial<Pick<PendingAttendanceEntry, 'syncState' | 'failReason' | 'conflictId'>>,
): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb(tenantId);
  const tx = db.transaction(STORE_QUEUE, 'readwrite');
  const store = tx.objectStore(STORE_QUEUE);
  const existing = (await requestToPromise(store.get(clientId))) as PendingAttendanceEntry | undefined;
  if (existing) store.put({ ...existing, ...patch });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Drops fully-synced entries so the queue doesn't grow forever — kept
 * entries are exactly what SyncLedger's detail view still has something to
 * say about (pending, sending, or failed). */
export async function pruneSentEntries(tenantId: string): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb(tenantId);
  const tx = db.transaction(STORE_QUEUE, 'readwrite');
  const store = tx.objectStore(STORE_QUEUE);
  const all = (await requestToPromise(store.getAll())) as PendingAttendanceEntry[];
  for (const entry of all) {
    if (entry.syncState === 'sent') store.delete(entry.clientId);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function queueScoreEntries(tenantId: string, entries: PendingScoreEntry[]): Promise<void> {
  if (!isBrowser() || entries.length === 0) return;
  const db = await openDb(tenantId);
  const tx = db.transaction(STORE_SCORE_QUEUE, 'readwrite');
  const store = tx.objectStore(STORE_SCORE_QUEUE);
  for (const entry of entries) store.put(entry);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getQueuedScoreEntries(tenantId: string): Promise<PendingScoreEntry[]> {
  if (!isBrowser()) return [];
  const db = await openDb(tenantId);
  const tx = db.transaction(STORE_SCORE_QUEUE, 'readonly');
  const entries = await requestToPromise(tx.objectStore(STORE_SCORE_QUEUE).getAll());
  return entries as PendingScoreEntry[];
}

export async function updateQueuedScoreEntryState(
  tenantId: string,
  clientId: string,
  patch: Partial<Pick<PendingScoreEntry, 'syncState' | 'failReason'>>,
): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb(tenantId);
  const tx = db.transaction(STORE_SCORE_QUEUE, 'readwrite');
  const store = tx.objectStore(STORE_SCORE_QUEUE);
  const existing = (await requestToPromise(store.get(clientId))) as PendingScoreEntry | undefined;
  if (existing) store.put({ ...existing, ...patch });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Removes one queued score entry outright — the only real fix for a
 * genuine 409 version conflict (see offline-sync.ts's flushScoreQueueNow
 * doc comment: retrying resends the same now-stale expectedVersion
 * forever). Distinct from pruneSentScoreEntries, which only ever touches
 * already-'sent' rows. */
export async function discardScoreEntry(tenantId: string, clientId: string): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb(tenantId);
  const tx = db.transaction(STORE_SCORE_QUEUE, 'readwrite');
  tx.objectStore(STORE_SCORE_QUEUE).delete(clientId);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function pruneSentScoreEntries(tenantId: string): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb(tenantId);
  const tx = db.transaction(STORE_SCORE_QUEUE, 'readwrite');
  const store = tx.objectStore(STORE_SCORE_QUEUE);
  const all = (await requestToPromise(store.getAll())) as PendingScoreEntry[];
  for (const entry of all) {
    if (entry.syncState === 'sent') store.delete(entry.clientId);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function cacheRosterData(tenantId: string, key: string, data: unknown): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb(tenantId);
  const tx = db.transaction(STORE_ROSTER, 'readwrite');
  tx.objectStore(STORE_ROSTER).put({ key, data, cachedAt: new Date().toISOString() });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedRosterData<T>(tenantId: string, key: string): Promise<T | null> {
  if (!isBrowser()) return null;
  const db = await openDb(tenantId);
  const tx = db.transaction(STORE_ROSTER, 'readonly');
  const row = (await requestToPromise(tx.objectStore(STORE_ROSTER).get(key))) as
    | { key: string; data: T }
    | undefined;
  return row ? row.data : null;
}

/**
 * A public `public/sw.js` file has no access to Next's build-time
 * `NEXT_PUBLIC_*` env inlining — it's a static file, not bundled. The page
 * (which DOES have that value at runtime) mirrors it here once at startup
 * so a background 'sync' event firing later, possibly with no page open,
 * still knows which API origin to POST the queue to. Reuses `auth_mirror`
 * (same {key, value} shape) rather than adding a fourth store for one
 * string.
 */
export async function mirrorApiBaseUrl(tenantId: string, apiBaseUrl: string): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb(tenantId);
  const tx = db.transaction(STORE_AUTH, 'readwrite');
  tx.objectStore(STORE_AUTH).put({ key: 'apiBaseUrl', value: apiBaseUrl });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function mirrorAuthTokens(
  tenantId: string,
  accessToken: string,
  refreshToken: string | null,
): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb(tenantId);
  const tx = db.transaction(STORE_AUTH, 'readwrite');
  const store = tx.objectStore(STORE_AUTH);
  store.put({ key: 'access', value: accessToken });
  if (refreshToken) store.put({ key: 'refresh', value: refreshToken });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Deletes the entire tenant-namespaced database — spec §9.1's "cleared on
 * logout." Closes this page's open connection first; IndexedDB refuses to
 * delete a database with a live connection anywhere, and this page's own
 * connection is the one guaranteed to be open.
 */
export async function clearOfflineDb(tenantId: string): Promise<void> {
  if (!isBrowser()) return;
  const openPromise = openDbs.get(tenantId);
  if (openPromise) {
    const db = await openPromise;
    db.close();
    openDbs.delete(tenantId);
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName(tenantId));
    req.onsuccess = () => resolve();
    req.onerror = () => resolve(); // best-effort — logout must not hang on this
    req.onblocked = () => resolve();
  });
}
