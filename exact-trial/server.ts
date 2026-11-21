// The trial's API server: `bun server.ts`. Same tables as the Expo app's /api/inventory route.
// It talks to Turso (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN) and checks TEAM_CODE on every request.
// `test` and `verify` set DB to a scratch file instead, so tests never touch Turso.
import { createClient } from '@libsql/client';
import { createHash, timingSafeEqual } from 'node:crypto';
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

await db.batch(
  [
    'CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS stores (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS stock (store_id INTEGER NOT NULL, product_id INTEGER NOT NULL, count INTEGER NOT NULL CHECK (count >= 0), PRIMARY KEY (store_id, product_id))',
  ],
  'write',
);

const MAX_COUNT = 1_000_000;
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const sha = (s: string) => createHash('sha256').update(s).digest();
const authorized = (req: Request) => timingSafeEqual(sha(req.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''), sha(TEAM_CODE));

// The web app's page is another origin: every answer, and the preflight, allows it.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, DELETE' };
const send = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const preflight = () => new Response(null, { status: 204, headers: CORS });
// Every route but the preflight checks the team code first.
const guard =
  <A extends unknown[]>(handler: (req: Request & { params: Record<string, string> }, ...a: A) => Promise<Response>) =>
  (req: Request & { params: Record<string, string> }, ...a: A) =>
    authorized(req) ? handler(req, ...a) : Promise.resolve(send({ error: 'Wrong team code.' }, 401));

// Each name with how many products are out (0) and low (1–3) there; products answer 0 for both.
const LOW = 3;
const names = async (list: 'products' | 'stores') =>
  (
    await db.execute(
      list === 'stores'
        ? `SELECT s.id, s.name,
             coalesce(sum(p.id IS NOT NULL AND coalesce(st.count, 0) = 0), 0) AS out,
             coalesce(sum(p.id IS NOT NULL AND coalesce(st.count, 0) BETWEEN 1 AND ${LOW}), 0) AS low
           FROM stores s LEFT JOIN products p ON 1 LEFT JOIN stock st ON st.store_id = s.id AND st.product_id = p.id
           GROUP BY s.id ORDER BY s.name`
        : 'SELECT id, name, 0 AS out, 0 AS low FROM products ORDER BY name',
    )
  ).rows.map((r) => ({ id: Number(r.id), name: String(r.name), out: Number(r.out), low: Number(r.low) }));

const nameList = (list: 'products' | 'stores') => ({
  OPTIONS: preflight,
  GET: guard(async () => send(await names(list))),
  POST: guard(async (req) => {
    const { name } = await req.json().catch(() => ({}));
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || trimmed.length > 100) return send({ error: 'Enter a name of up to 100 characters.' }, 400);
    await db.execute({ sql: `INSERT INTO ${list} (name) VALUES (?)`, args: [trimmed] });
    return send({ ok: true }, 201);
  }),
});

const removeFrom = (list: 'products' | 'stores') => ({
  OPTIONS: preflight,
  // Deleting a product or store deletes its stock counts too.
  DELETE: guard(async (req) => {
    const id = Number(req.params.id);
    if (!isId(id)) return send({ error: 'Invalid request.' }, 400);
    await db.batch(
      [
        { sql: `DELETE FROM ${list} WHERE id = ?`, args: [id] },
        { sql: `DELETE FROM stock WHERE ${list === 'stores' ? 'store_id' : 'product_id'} = ?`, args: [id] },
      ],
      'write',
    );
    return send({ ok: true });
  }),
});

const { hostname, port } = new URL(API);
Bun.serve({
  hostname,
  port: Number(port),
  routes: {
    '/health': () => new Response('ok'),
    '/products': nameList('products'),
    '/stores': nameList('stores'),
    '/products/:id': removeFrom('products'),
    '/stores/:id': removeFrom('stores'),
    // Every product with its count at one store; a product with no stock row counts 0.
    '/stores/:id/stock': {
      OPTIONS: preflight,
      GET: guard(async (req) => {
        const rs = await db.execute({
          sql: 'SELECT p.id, p.name, coalesce(s.count, 0) AS count FROM products p LEFT JOIN stock s ON s.product_id = p.id AND s.store_id = ? ORDER BY p.name',
          args: [Number(req.params.id)],
        });
        return send(rs.rows.map((r) => ({ id: Number(r.id), name: String(r.name), count: Number(r.count) })));
      }),
    },
    // A typed count; the app's Undo sends the previous count here too.
    '/set': {
      OPTIONS: preflight,
      POST: guard(async (req) => {
        const { storeId, productId, count } = await req.json().catch(() => ({}));
        if (!isId(storeId) || !isId(productId) || !Number.isInteger(count) || count < 0 || count > MAX_COUNT) return send({ error: 'Invalid request.' }, 400);
        const res = await db.execute({
          sql: `INSERT INTO stock SELECT ?1, ?2, ?3
            WHERE EXISTS (SELECT 1 FROM stores WHERE id = ?1) AND EXISTS (SELECT 1 FROM products WHERE id = ?2)
            ON CONFLICT DO UPDATE SET count = ?3`,
          args: [storeId, productId, count],
        });
        if (res.rowsAffected === 0) return send({ error: 'That product or store was removed. The list is up to date now.' }, 409);
        return send({ ok: true });
      }),
    },
    '/adjust': {
      OPTIONS: preflight,
      POST: guard(async (req) => {
        const { storeId, productId, delta } = await req.json().catch(() => ({}));
        if (!isId(storeId) || !isId(productId) || !Number.isInteger(delta) || Math.abs(delta) > MAX_COUNT) return send({ error: 'Invalid request.' }, 400);
        // Applied as a delta in SQL so two people tapping at once don't overwrite each other.
        const res = await db.execute({
          sql: `INSERT INTO stock SELECT ?1, ?2, max(0, ?3)
            WHERE EXISTS (SELECT 1 FROM stores WHERE id = ?1) AND EXISTS (SELECT 1 FROM products WHERE id = ?2)
            ON CONFLICT DO UPDATE SET count = min(?4, max(0, count + ?3))`,
          args: [storeId, productId, delta, MAX_COUNT],
        });
        if (res.rowsAffected === 0) return send({ error: 'That product or store was removed. The list is up to date now.' }, 409);
        return send({ ok: true });
      }),
    },
  },
});
console.log(`server.ts: ${API}`);
