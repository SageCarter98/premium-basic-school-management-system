import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './auth-token-store';
import { API_BASE_URL } from './api-base-url';

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
  }
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export type LoginResult =
  | { mfaRequired: true; challengeToken: string }
  | { mfaSetupRequired: true; accessToken: string }
  | { accessToken: string; refreshToken: string };

export async function login(email: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${API_BASE_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await parseJson(res);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as LoginResult;
}

// Dedups concurrent refresh attempts. Without this, two widgets 401'ing at
// the same moment each call refreshSession() independently — the first
// rotates the refresh token server-side, the second then presents the
// now-already-rotated token, which trips the backend's reuse-detection
// (auth.module.ts) and revokes the ENTIRE token family, including the
// replacement the first call just legitimately got. A shared in-flight
// promise means every concurrent 401 awaits the same single refresh call
// instead of racing each other into that reuse-detection trap.
let inFlightRefresh: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = doRefresh().finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}

async function doRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  const res = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;
  const body = (await parseJson(res)) as { accessToken: string; refreshToken: string };
  setTokens(body.accessToken, body.refreshToken);
  return true;
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  clearTokens();
  if (!refreshToken) return;
  try {
    await fetch(`${API_BASE_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // logout is best-effort client-side; tokens are already cleared locally
  }
}

/**
 * Authenticated fetch for every other endpoint. On a 401, attempts exactly
 * one silent refresh-and-retry (matching the backend's real rotation
 * semantics — a second consecutive 401 means the session is genuinely
 * gone, not worth retrying again) before giving up and clearing the
 * session for the caller (RequireAuth) to redirect on.
 */
export async function apiFetch(path: string, options: RequestInit = {}, isRetry = false): Promise<Response> {
  const accessToken = getAccessToken();
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (res.status === 401 && !isRetry) {
    const refreshed = await refreshSession();
    if (refreshed) return apiFetch(path, options, true);
    clearTokens();
  }

  return res;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  const body = await parseJson(res);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
