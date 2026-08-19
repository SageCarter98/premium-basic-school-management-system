/**
 * parent-api.ts — Stage 6 (Parent View). A deliberately separate, smaller
 * fetch helper from api-client.ts: a guardian's session is a possession-
 * based `?token=` query param verified fresh by tenant.middleware.ts on
 * every request (apps/api's PARENT_PATH_PREFIX branch), never a Bearer
 * JWT — there is no login, no localStorage token pair, no refresh-and-
 * retry dance to reuse from api-client.ts here.
 */

import { API_BASE_URL } from './api-base-url';

export class ParentApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Parent API error ${status}`);
  }
}

export async function parentApiGet<T>(path: string, token: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`);
  url.searchParams.set('token', token);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
  }
  const res = await fetch(url.toString());
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ParentApiError(res.status, body);
  return body as T;
}
