// The API for local dev and Exact's tests: `bun server.ts`. Production serves the same handler
// from Expo Hosting at /api (src/app/api/[...path]+api.ts).
// It talks to Turso (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN) and checks TEAM_CODE on every request.
// `test` and `verify` set DB to a scratch file instead, so tests never touch Turso.
import { createClient } from '@libsql/client';
import { handle } from './src/server/api.ts';
import { SCHEMA } from './src/server/db.ts';
import { API } from './app.ts';

const db = process.env.DB
  ? createClient({ url: `file:${process.env.DB}` })
  : createClient({
      // @libsql/client refuses `turso:` URLs; the same host answers as `libsql:`.
      url: (process.env.TURSO_DATABASE_URL ?? 'file:data.db').replace(/^turso:/, 'libsql:'),
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

// Every device signs in with one shared team code. Tests (a scratch DB) always use `test-code`.
const TEAM_CODE = process.env.DB ? 'test-code' : process.env.TEAM_CODE;
if (!TEAM_CODE) throw new Error('Set TEAM_CODE before starting server.ts');

await db.batch(SCHEMA, 'write');

const { hostname, port } = new URL(API);
Bun.serve({ hostname, port: Number(port), fetch: (req) => handle(req, db, TEAM_CODE) });
console.log(`server.ts: ${API}`);
