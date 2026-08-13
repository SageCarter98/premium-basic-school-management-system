import { config } from 'dotenv';
import { resolve } from 'path';

// npm workspace scripts run with cwd = apps/api, but .env lives at the repo
// root (pbsms-platform/.env) — bare `dotenv/config` looks in cwd and would
// silently find nothing, leaving TEST_DATABASE_URL/DATABASE_URL undefined.
config({ path: resolve(__dirname, '../../../.env') });
