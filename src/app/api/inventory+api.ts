/// <reference types="node" />
import { createHash, timingSafeEqual } from 'node:crypto';
import { db, ready } from '../../server/db';

const MAX_COUNT = 1_000_000;
const sha = (s: string) => createHash('sha256').update(s).digest();

// Every device signs in with one shared team code, set as TEAM_CODE on the server.
function authorized(request: Request) {
  const code = process.env.TEAM_CODE;
  if (!code) throw new Error('TEAM_CODE is not set on the server');
  return timingSafeEqual(sha(request.headers.get('x-team-code') ?? ''), sha(code));
}

async function snapshot() {
  const [products, stores, rows] = await db().batch(
    ['SELECT id, name FROM products ORDER BY name', 'SELECT id, name FROM stores ORDER BY name', 'SELECT store_id, product_id, count FROM stock'],
    'read',
  );
  const stock: Record<string, number> = {};
  for (const r of rows.rows) stock[`${r.store_id}:${r.product_id}`] = Number(r.count);
  const items = (rs: typeof products) => rs.rows.map((r) => ({ id: Number(r.id), name: String(r.name) }));
  return { products: items(products), stores: items(stores), stock };
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response('Wrong team code', { status: 401 });
  await ready();
  return Response.json(await snapshot());
}

const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isId = (v: unknown): v is number => isInt(v, 1, Number.MAX_SAFE_INTEGER);
const isList = (v: unknown): v is 'products' | 'stores' => v === 'products' || v === 'stores';
// Only write a count when both the store and product still exist.
const BOTH_EXIST = 'EXISTS (SELECT 1 FROM stores WHERE id = ?1) AND EXISTS (SELECT 1 FROM products WHERE id = ?2)';

export async function POST(request: Request) {
  if (!authorized(request)) return new Response('Wrong team code', { status: 401 });
  await ready();
  const a = await request.json().catch(() => null);
  const name = typeof a?.name === 'string' ? a.name.trim() : '';
  const ids = isId(a?.storeId) && isId(a?.productId);

  if (a?.type === 'add' && isList(a.list) && name && name.length <= 100) {
    await db().execute({ sql: `INSERT INTO ${a.list} (name) VALUES (?)`, args: [name] });
  } else if (a?.type === 'remove' && isList(a.list) && isId(a.id)) {
    const column = a.list === 'stores' ? 'store_id' : 'product_id';
    await db().batch(
      [
        { sql: `DELETE FROM ${a.list} WHERE id = ?`, args: [a.id] },
        { sql: `DELETE FROM stock WHERE ${column} = ?`, args: [a.id] },
      ],
      'write',
    );
  } else if ((a?.type === 'set' && ids && isInt(a.count, 0, MAX_COUNT)) || (a?.type === 'adjust' && ids && isInt(a.delta, -MAX_COUNT, MAX_COUNT))) {
    const res = await db().execute(
      a.type === 'set'
        ? { sql: `INSERT INTO stock SELECT ?1, ?2, ?3 WHERE ${BOTH_EXIST} ON CONFLICT DO UPDATE SET count = ?3`, args: [a.storeId, a.productId, a.count] }
        : {
            // Apply +/- as a delta in SQL so two people tapping at once don't overwrite each other.
            sql: `INSERT INTO stock SELECT ?1, ?2, max(0, ?3) WHERE ${BOTH_EXIST} ON CONFLICT DO UPDATE SET count = min(?4, max(0, count + ?3))`,
            args: [a.storeId, a.productId, a.delta, MAX_COUNT],
          },
    );
    // Someone else deleted that product or store; send the current list.
    if (res.rowsAffected === 0) return Response.json(await snapshot(), { status: 409 });
  } else {
    return new Response('Invalid request', { status: 400 });
  }
  return Response.json(await snapshot());
}
