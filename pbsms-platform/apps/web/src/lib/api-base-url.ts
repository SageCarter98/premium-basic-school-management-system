/**
 * Its own tiny module rather than living in api-client.ts, so
 * auth-token-store.ts can import it without an api-client.ts <->
 * auth-token-store.ts circular import (api-client.ts already imports
 * token helpers from auth-token-store.ts).
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
