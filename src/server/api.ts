/// <reference types="node" />
// The Exact app's REST API. Expo Hosting serves it at /api/* (src/app/api/[...path]+api.ts);
// server.ts serves it on 127.0.0.1:8787 for local dev and Exact's tests.
import type { Client } from '@libsql/client/web';
import { createHash, timingSafeEqual } from 'node:crypto';

const MAX_COUNT = 1_000_000;
// Products at a store with this many or fewer count as low; app.contract's `isLow` matches.
const LOW = 3;
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const sha = (s: string) => createHash('sha256').update(s).digest();

// The web app's page may be another origin (local dev): every answer, and the preflight, allows it.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, DELETE' };
const send = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const removed = () => send({ error: 'That product or store was removed. The list is up to date now.' }, 409);
const BOTH_EXIST = 'EXISTS (SELECT 1 FROM stores WHERE id = ?1) AND EXISTS (SELECT 1 FROM products WHERE id = ?2)';

// Each name with how many products are out (0) and low (1–3) there; products answer 0 for both.
const names = async (db: Client, list: 'products' | 'stores') =>
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

// `teamCode` is the one code every device signs in with, sent as `Authorization: Bearer <code>`.
export async function handle(req: Request, db: Client, teamCode: string): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  // Expo Hosting mounts the API at /api; the local server at the root.
  const path = new URL(req.url).pathname.replace(/^\/api(?=\/)/, '');
  if (path === '/health') return new Response('ok');
  const given = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!timingSafeEqual(sha(given), sha(teamCode))) return send({ error: 'Wrong team code.' }, 401);

  const [, list, id, sub] = path.split('/');
  const isList = list === 'products' || list === 'stores';
  // Such as `DELETE :list/:id` for DELETE /stores/4.
  const route = `${req.method} ${isList ? ':list' : list}${id ? '/:id' : ''}${sub ? `/${sub}` : ''}`;
  const json = req.method === 'POST' ? await req.json().catch(() => null) : null;
  const body = json !== null && typeof json === 'object' ? json : {};

  switch (route) {
    case 'GET :list':
      return send(await names(db, list as 'products' | 'stores'));
    case 'POST :list': {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 100) return send({ error: 'Enter a name of up to 100 characters.' }, 400);
      await db.execute({ sql: `INSERT INTO ${list} (name) VALUES (?)`, args: [name] });
      return send({ ok: true }, 201);
    }
    // Deleting a product or store deletes its stock counts too.
    case 'DELETE :list/:id': {
      const n = Number(id);
      if (!isId(n)) return send({ error: 'Invalid request.' }, 400);
      await db.batch(
        [
          { sql: `DELETE FROM ${list} WHERE id = ?`, args: [n] },
          { sql: `DELETE FROM stock WHERE ${list === 'stores' ? 'store_id' : 'product_id'} = ?`, args: [n] },
        ],
        'write',
      );
      return send({ ok: true });
    }
    // Every product with its count at one store; a product with no stock row counts 0.
    case 'GET :list/:id/stock': {
      if (list !== 'stores') break;
      const rs = await db.execute({
        sql: 'SELECT p.id, p.name, coalesce(s.count, 0) AS count FROM products p LEFT JOIN stock s ON s.product_id = p.id AND s.store_id = ? ORDER BY p.name',
        args: [Number(id)],
      });
      return send(rs.rows.map((r) => ({ id: Number(r.id), name: String(r.name), count: Number(r.count) })));
    }
    // A typed count; the app's Undo sends the previous count here too.
    case 'POST set': {
      const { storeId, productId, count } = body;
      if (!isId(storeId) || !isId(productId) || !Number.isInteger(count) || count < 0 || count > MAX_COUNT) return send({ error: 'Invalid request.' }, 400);
      const res = await db.execute({
        sql: `INSERT INTO stock SELECT ?1, ?2, ?3 WHERE ${BOTH_EXIST} ON CONFLICT DO UPDATE SET count = ?3`,
        args: [storeId, productId, count],
      });
      return res.rowsAffected === 0 ? removed() : send({ ok: true });
    }
    case 'POST adjust': {
      const { storeId, productId, delta } = body;
      if (!isId(storeId) || !isId(productId) || !Number.isInteger(delta) || Math.abs(delta) > MAX_COUNT) return send({ error: 'Invalid request.' }, 400);
      // Applied as a delta in SQL so two people tapping at once don't overwrite each other.
      const res = await db.execute({
        sql: `INSERT INTO stock SELECT ?1, ?2, max(0, ?3) WHERE ${BOTH_EXIST} ON CONFLICT DO UPDATE SET count = min(?4, max(0, count + ?3))`,
        args: [storeId, productId, delta, MAX_COUNT],
      });
      return res.rowsAffected === 0 ? removed() : send({ ok: true });
    }
  }
  return send({ error: isList ? 'Invalid request.' : 'Not found.' }, isList ? 400 : 404);
}
