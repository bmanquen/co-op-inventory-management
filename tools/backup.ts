// Copies the Turso database at TURSO_DATABASE_URL into a new local SQLite file: `bun tools/backup.ts out.db`.
// .github/workflows/backup.yml runs it weekly on production. The file opens in `sqlite3`, and
// `turso db create <name> --from-file out.db` turns it back into a Turso database.
import { createClient } from '@libsql/client';
import { existsSync } from 'node:fs';

const out = process.argv[2];
if (!out || existsSync(out)) throw new Error('Usage: bun tools/backup.ts <new-file.db>');
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN)');

// bigint so no integer loses precision on the way through.
const src = createClient({ url: url.replace(/^turso:/, 'libsql:'), authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'bigint' });
const dst = createClient({ url: `file:${out}`, intMode: 'bigint' });

// Tables before indexes; SQLite's, libSQL's and Turso's own tables are made by the engine itself.
const schema = (
  await src.execute(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE 'libsql\\_%' ESCAPE '\\' AND name NOT LIKE '\\_\\_turso\\_internal%' ESCAPE '\\' ORDER BY type <> 'table'",
  )
).rows.map((r) => ({ type: String(r.type), name: String(r.name), sql: String(r.sql) }));
const tables = schema.filter((s) => s.type === 'table').map((s) => s.name);

// One read transaction, so every table comes from the same moment. sqlite_sequence keeps
// AUTOINCREMENT's counters, so a restored database still never reuses a deleted ID.
const reads = await src.batch([...tables.map((t) => `SELECT * FROM "${t}"`), 'SELECT name, seq FROM sqlite_sequence'], 'read');

const copy = (t: string, i: number) =>
  reads[i].rows.map((r) => ({
    sql: `INSERT INTO "${t}" VALUES (${reads[i].columns.map(() => '?').join(', ')})`,
    args: reads[i].columns.map((_, c) => r[c]),
  }));
await dst.batch(
  [
    ...schema.map((s) => s.sql),
    ...tables.flatMap(copy),
    // Copying the rows set new counters from the highest copied ID; replace them with the real ones.
    'DELETE FROM sqlite_sequence',
    ...copy('sqlite_sequence', tables.length),
  ],
  'write',
);
console.log(tables.map((t, i) => `${t}: ${reads[i].rows.length} rows`).join(', '));
