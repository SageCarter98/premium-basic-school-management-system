/**
 * auth-token-store.ts
 *
 * The backend is deliberately Bearer-only (no Set-Cookie path — see
 * apps/api/src/main.ts's CORS comment and the README's SEC-040 note on
 * why this API has never used cookies). localStorage is the storage
 * mechanism that fits that, and it's what the offline/service-worker sync
 * layer (Stage 3) needs anyway. Guarded against SSR (Next.js renders this
 * module's callers on the server too, where `window` and `localStorage`
 * don't exist).
 *
 * Stage 3 addition: every token write/clear here also mirrors into
 * offline-db.ts's IndexedDB `auth_mirror` store. A service worker can't
 * read localStorage (it isn't a window), but it can read IndexedDB — that
 * mirror is what lets sw.js authenticate a background sync of the queued
 * attendance writes without the page being open. Mirroring is best-effort
 * (fire-and-forget): a failure to mirror only degrades background sync to
 * "retry next time the page is open," it must never block login/logout.
 */

import { clearOfflineDb, mirrorApiBaseUrl, mirrorAuthTokens } from './offline-db';
import { API_BASE_URL } from './api-base-url';

const ACCESS_TOKEN_KEY = 'pbsms.accessToken';
const REFRESH_TOKEN_KEY = 'pbsms.refreshToken';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function getAccessToken(): string | null {
  return isBrowser() ? localStorage.getItem(ACCESS_TOKEN_KEY) : null;
}

export function getRefreshToken(): string | null {
  return isBrowser() ? localStorage.getItem(REFRESH_TOKEN_KEY) : null;
}

/** Decodes the JWT payload without verifying the signature — used here
 * only to find the tenantId a token belongs to, for namespacing the
 * offline mirror. Duplicated (not imported) from decodeAccessToken() below
 * so it can decode an arbitrary token string, not just the one currently
 * stored. */
function decodeTenantId(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { tenantId: string | null }).tenantId;
  } catch {
    return null;
  }
}

export function setTokens(accessToken: string, refreshToken?: string): void {
  if (!isBrowser()) return;
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  }
  const tenantId = decodeTenantId(accessToken);
  if (tenantId) {
    mirrorAuthTokens(tenantId, accessToken, refreshToken ?? getRefreshToken()).catch(() => {
      // best-effort — see file header
    });
    mirrorApiBaseUrl(tenantId, API_BASE_URL).catch(() => {
      // best-effort — see file header
    });
  }
}

export function clearTokens(): void {
  if (!isBrowser()) return;
  const currentAccessToken = getAccessToken();
  const tenantId = currentAccessToken ? decodeTenantId(currentAccessToken) : null;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  if (tenantId) {
    clearOfflineDb(tenantId).catch(() => {
      // best-effort — see file header
    });
  }
}

export function hasSession(): boolean {
  return getAccessToken() !== null;
}

/**
 * Decodes the JWT payload without verifying the signature — verification
 * is the server's job on every request (spec §11/§34.5: the UI only
 * declutters, it is never the authority). Used here only to read
 * roleCodes/tenantId for nav rendering.
 *
 * `impersonationGrantId`/`exp` are optional because only an impersonation
 * token minted by impersonation.service.ts's mintToken() carries the
 * former, and `exp` is whatever the signing call's `expiresIn` produced
 * (present on every real token this codebase issues, absent only on the
 * unusual case of a hand-decoded garbage string).
 */
export function decodeAccessToken(): {
  sub: string;
  tenantId: string | null;
  isPlatformUser: boolean;
  roleCodes: string[];
  impersonationGrantId?: string;
  exp?: number;
} | null {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Stage 9 (Platform Console / impersonation, TEN-021). A mintToken()
 * response is a genuinely separate, tenant-shaped session that behaves
 * exactly like an ordinary Staff Console login (same AppShell, same
 * apiFetch) for the duration of the grant — this stashes the PLATFORM
 * user's own session (sessionStorage, deliberately not localStorage, same
 * "shouldn't survive careless tab persistence" reasoning
 * use-parent-token.ts already established) so it can be restored when the
 * impersonation session ends, rather than losing the platform operator's
 * own login. Impersonation tokens have no refresh token (mintToken()
 * issues access-only, time-boxed to the grant) — the active refresh token
 * is cleared for the duration, not stashed as part of the impersonation
 * session's own state.
 */
const IMPERSONATION_STASH_KEY = 'pbsms.impersonationStash';

export interface ImpersonationStash {
  accessToken: string;
  refreshToken: string | null;
  ticketRef: string;
  tenantName: string;
}

export function enterImpersonation(accessToken: string, meta: { ticketRef: string; tenantName: string }): void {
  if (!isBrowser()) return;
  const stash: ImpersonationStash = {
    accessToken: getAccessToken() ?? '',
    refreshToken: getRefreshToken(),
    ...meta,
  };
  sessionStorage.setItem(IMPERSONATION_STASH_KEY, JSON.stringify(stash));
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function getImpersonationStash(): ImpersonationStash | null {
  if (!isBrowser()) return null;
  const raw = sessionStorage.getItem(IMPERSONATION_STASH_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ImpersonationStash;
  } catch {
    return null;
  }
}

/** Restores the stashed platform session as the active one. Does NOT call
 * the backend's own end-grant endpoint — the caller (ImpersonationBanner)
 * does that first, using the still-active impersonation token's claims to
 * find the grantId, then calls this to swap back. */
export function exitImpersonation(): void {
  if (!isBrowser()) return;
  const stash = getImpersonationStash();
  if (!stash) return;
  localStorage.setItem(ACCESS_TOKEN_KEY, stash.accessToken);
  if (stash.refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, stash.refreshToken);
  } else {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
  sessionStorage.removeItem(IMPERSONATION_STASH_KEY);
}
