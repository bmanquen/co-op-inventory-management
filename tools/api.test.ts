// The REST API (src/server/api.ts) on its own, on an in-memory database: `bun test tools/`.
// The UI tests (app.test.contract) cover the paths the app takes; these cover the server's refusals.
import { createClient } from '@libsql/client';
import { beforeEach, expect, test } from 'bun:test';
import { handle } from '../src/server/api.ts';
import { SCHEMA } from '../src/server/db.ts';

let db: ReturnType<typeof createClient>;
beforeEach(async () => {
  db = createClient({ url: ':memory:' });
  await db.batch(SCHEMA, 'write');
});

const call = (method: string, path: string, body?: unknown, code = 'team') =>
  handle(new Request(`http://x/api${path}`, { method, headers: { authorization: `Bearer ${code}` }, body: body && JSON.stringify(body) }), db, 'team');
const json = async (method: string, path: string, body?: unknown) => (await call(method, path, body)).json();

test('only the team code gets in', async () => {
  expect((await call('GET', '/stores', undefined, 'nope')).status).toBe(401);
  expect((await call('GET', '/stores', undefined, '')).status).toBe(401);
  expect((await call('GET', '/stores')).status).toBe(200);
});

test('a store counts its products out (0) and low (1 to 3)', async () => {
  await call('POST', '/stores', { name: 'Downtown' });
  for (const name of ['A', 'B', 'C', 'D']) await call('POST', '/products', { name });
  await call('POST', '/set', { storeId: 1, productId: 2, count: 3 });
  await call('POST', '/set', { storeId: 1, productId: 3, count: 4 });
  // A has no stock row (0, out), B is 3 (low), C is 4 (neither), D is set to 0 (out).
  await call('POST', '/set', { storeId: 1, productId: 4, count: 0 });
  expect(await json('GET', '/stores')).toEqual([{ id: 1, name: 'Downtown', out: 2, low: 1 }]);
});

test('+/− never goes below 0, and adds up when two people tap at once', async () => {
  await call('POST', '/stores', { name: 'Downtown' });
  await call('POST', '/products', { name: 'Decaf' });
  await call('POST', '/adjust', { storeId: 1, productId: 1, delta: -2 });
  await Promise.all([1, 1, 1].map((delta) => call('POST', '/adjust', { storeId: 1, productId: 1, delta })));
  expect(await json('GET', '/stores/1/stock')).toEqual([{ id: 1, name: 'Decaf', count: 3 }]);
});

test('a queued change sent twice counts once and is kept in the history', async () => {
  await call('POST', '/stores', { name: 'Downtown' });
  await call('POST', '/products', { name: 'Decaf' });
  const change = { storeId: 1, productId: 1, delta: 2, changeId: 'phone-a-1' };
  // Two sends at once (a retry racing its lost reply) and one later: all answered OK, applied once.
  const sends = await Promise.all([call('POST', '/adjust', change), call('POST', '/adjust', change)]);
  expect(sends.map((r) => r.status)).toEqual([200, 200]);
  expect((await call('POST', '/adjust', change)).status).toBe(200);
  await call('POST', '/adjust', { ...change, delta: -5, changeId: 'phone-b-1' });
  expect(await json('GET', '/stores/1/stock')).toEqual([{ id: 1, name: 'Decaf', count: 0 }]);
  const history = (await db.execute('SELECT id, delta FROM stock_changes ORDER BY id')).rows.map((r) => [r.id, r.delta]);
  expect(history).toEqual([['phone-a-1', 2], ['phone-b-1', -5]]);
  // A new change for a removed store is refused, so the device can drop it; a bad ID never gets in.
  await call('DELETE', '/stores/1');
  expect((await call('POST', '/adjust', { ...change, changeId: 'phone-a-2' })).status).toBe(409);
  expect((await call('POST', '/adjust', { ...change, changeId: 'no spaces' })).status).toBe(400);
  expect((await db.execute('SELECT count(*) AS n FROM stock_changes')).rows[0].n).toBe(2);
});

test('a count for a removed store is refused, and removing a store removes its counts', async () => {
  await call('POST', '/stores', { name: 'Downtown' });
  await call('POST', '/products', { name: 'Decaf' });
  await call('POST', '/set', { storeId: 1, productId: 1, count: 5 });
  expect((await call('DELETE', '/stores/1')).status).toBe(200);
  expect((await db.execute('SELECT count(*) AS n FROM stock')).rows[0].n).toBe(0);
  expect((await call('POST', '/adjust', { storeId: 1, productId: 1, delta: 1 })).status).toBe(409);
  expect((await db.execute('SELECT count(*) AS n FROM stock')).rows[0].n).toBe(0);
});

test('bad input is refused', async () => {
  await call('POST', '/stores', { name: 'Downtown' });
  await call('POST', '/products', { name: 'Decaf' });
  expect((await call('POST', '/stores', { name: 'x'.repeat(101) })).status).toBe(400);
  expect((await call('POST', '/stores', { name: '   ' })).status).toBe(400);
  // A name already there, in any case, is refused; the same name in the other list is fine.
  const dup = await call('POST', '/stores', { name: ' downtown ' });
  expect(dup.status).toBe(409);
  expect((await dup.json()).error).toBe('“Downtown” is already on the list.');
  expect((await call('POST', '/products', { name: 'Downtown' })).status).toBe(201);
  expect((await call('POST', '/set', { storeId: 1, productId: 1, count: 1_000_001 })).status).toBe(400);
  expect((await call('POST', '/set', { storeId: 1, productId: 1, count: 1.5 })).status).toBe(400);
  expect((await call('DELETE', '/stores/abc')).status).toBe(400);
  expect((await call('GET', '/stores/abc/stock')).status).toBe(400);
  expect((await call('GET', '/nowhere')).status).toBe(404);
});
