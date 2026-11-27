import type { Answer, Overlay, Result, Sources } from './app.contract.d.ts';

// The server's address, fixed at build: API_BASE_URL for a deploy (Expo Hosting's /api, see
// scripts/build-web.sh), else the local server.ts, which listens on it.
export const API = import.meta.env.API_BASE_URL ?? 'http://127.0.0.1:8787';
// +/− taps wait in this on-device database until the server takes them.
const OUTBOX = 'app:/data/outbox.db';
export const grants = `net.fetch ${API}\nsqlite.open ${OUTBOX}`;

type Row = { id: number; name: string; out: number; low: number };
type Line = { id: number; name: string; count: number };
const isRow = (v: unknown): v is Row =>
  v !== null && typeof v === 'object' && Number.isSafeInteger((v as Row).id) && typeof (v as Row).name === 'string' &&
  Number.isInteger((v as Row).out) && Number.isInteger((v as Row).low);
const isLine = (v: unknown): v is Line =>
  v !== null && typeof v === 'object' && Number.isSafeInteger((v as Line).id) && typeof (v as Line).name === 'string' && Number.isInteger((v as Line).count);

// The team code travels as a bearer token on every request.
const request = (code: string, path: string, init: RequestInit = {}, timeout = 10000) =>
  fetch(`${API}${path}`, { ...init, exactTimeout: timeout, headers: { authorization: `Bearer ${code}`, 'content-type': 'application/json' } });

// A read: undefined when the code was refused, so the screen can ask for it again.
async function read(code: string, path: string, timeout?: number): Promise<unknown[] | undefined> {
  const res = await request(code, path, {}, timeout);
  if (res.status === 401) return undefined;
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error('The server returned an invalid list.');
  return body;
}

// A write: always a shaped reply, so the screen can say what went wrong.
async function write(code: string, path: string, init: RequestInit) {
  try {
    const res = await request(code, path, init);
    if (res.ok) return { ok: true, error: '' };
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    return { ok: false, error: typeof body.error === 'string' ? body.error : 'The server had a problem. Try again.' };
  } catch (e) {
    if ((e as { code?: string }).code === 'bake') throw e; // no server at build
    return { ok: false, error: 'Can’t reach the server. Check your connection and try again.' };
  }
}

async function names(code: string, list: 'products' | 'stores', storage: Storage): Promise<Result<'loadStores'>> {
  if (code === '') return { code, denied: false, items: [], offline: false };
  const got = await fromDevice(storage, list, async (timeout) => {
    const body = await read(code, `/${list}`, timeout);
    if (!body) return 'denied';
    if (!body.every(isRow)) throw new Error('The server returned an invalid list.');
    return body.map((r) => ({ id: String(r.id), name: r.name, out: r.out, low: r.low }));
  });
  if (got === 'denied') return { code, denied: true, items: [], offline: false };
  return { code, denied: false, items: list === 'stores' ? await withWaitingTotals(storage, code, got.value) : got.value, offline: got.offline };
}

const isList = (list: string): list is 'products' | 'stores' => list === 'products' || list === 'stores';

// Local-first: the device's database is what every screen shows. It holds the last lists the server sent
// and the +/− taps it hasn't taken yet (the outbox); the server only ever updates that copy.
// shortcut: only +/− (and Undo) queue; typed counts, adds and deletes still need the server, and changes
// go out on a tap or the 10 s poll, not in the background (PRD: offline-first, #31–#33).
type Storage = Parameters<Sources['loadStock']>[2];
type Queued = { id: string; store: string; product: string; delta: number };
const errCode = (e: unknown) => (e as { code?: string } | null)?.code;
// Off the network (no connection, or it timed out), as opposed to an answer the server gave.
const unreachable = (e: unknown) => ['Network', 'Timeout'].includes((e as { kind?: string } | null)?.kind ?? '');

// Work that runs one at a time, in the order it was asked for.
const inTurn = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  };
};
// Sends, so two never take the same change and the oldest always goes first.
const serial = inTurn();
// The database, one connection at a time (the web allows one); never held across a network call.
const local = inTurn();

// Opened per use, as Exact's fieldnotes does: an open database locks its file (another tab on the web).
// Undefined where this host has no app storage (a test drive without a store): then nothing queues.
const outbox = <T>(storage: Storage, work: (db: Awaited<ReturnType<Storage['sqlite']['open']>>) => Promise<T>) => local(async () => {
  let db;
  try {
    db = await storage.sqlite.open(OUTBOX);
  } catch (e) {
    if (errCode(e) === 'agent' || errCode(e) === 'unsupported') return undefined;
    throw e;
  }
  try {
    await db.transaction([
      { sql: 'CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, code TEXT NOT NULL, store TEXT NOT NULL, product TEXT NOT NULL, delta INTEGER NOT NULL)' },
      // The last lists the server sent (stores, products, each store's stock), to show while it can't be reached.
      { sql: 'CREATE TABLE IF NOT EXISTS seen (key TEXT PRIMARY KEY, value TEXT NOT NULL)' },
    ]);
    return await work(db);
  } finally {
    await db.close();
  }
});
const remember = (storage: Storage, key: string, value: unknown) =>
  outbox(storage, (db) => db.execute('INSERT INTO seen VALUES (?, ?) ON CONFLICT DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]));
const recall = async <T>(storage: Storage, key: string): Promise<T | undefined> => {
  const rows = (await outbox(storage, (db) => db.query('SELECT value FROM seen WHERE key = ?', [key])))?.rows ?? [];
  return rows.length ? JSON.parse(String(rows[0][0])) : undefined;
};

// Brings the device's copy of one list up to date, then answers with it. With a copy already kept, a weak
// signal gives up after 3 s and the copy shows, marked offline, instead of the screen waiting 10 s.
// With nothing kept yet (first launch), the server must answer.
async function fromDevice<T>(storage: Storage, key: string, fetchFresh: (timeout: number) => Promise<T | 'denied'>) {
  const kept = await recall<T>(storage, key);
  try {
    const fresh = await fetchFresh(kept === undefined ? 10000 : 3000);
    if (fresh === 'denied') return 'denied' as const;
    await remember(storage, key, fresh);
    return { value: fresh, offline: false };
  } catch (e) {
    if (!unreachable(e) || kept === undefined) throw e;
    return { value: kept, offline: true };
  }
}

type Lines = Result<'loadStock'>['lines'];
// Products at a store with this many or fewer count as low; app.contract's `isLow` and the API match.
const LOW = 3;
const withTaps = (lines: Lines, taps: Queued[]) =>
  taps.reduce((ls, q) => ls.map((l) => (l.id !== q.product ? l : { ...l, count: Math.min(1_000_000, Math.max(0, l.count + q.delta)) })), lines);

// A store's out and low totals with this device's waiting taps counted, from its kept stock list.
async function withWaitingTotals(storage: Storage, team: string, items: Result<'loadStores'>['items']) {
  const waiting = await queued(storage, team);
  return Promise.all(
    items.map(async (s) => {
      const taps = waiting.filter((q) => q.store === s.id);
      const kept = taps.length ? await recall<Lines>(storage, `stock:${s.id}`) : undefined;
      if (!kept) return s;
      const counts = withTaps(kept, taps).map((l) => l.count);
      return { ...s, out: counts.filter((n) => n === 0).length, low: counts.filter((n) => n > 0 && n <= LOW).length };
    }),
  );
}

// Taps whose adjustStock hasn't answered yet: the overlay already shows them, so loadStock leaves them out.
const sending = new Set<string>();

const queued = async (storage: Storage, team: string): Promise<Queued[]> =>
  ((await outbox(storage, (db) => db.query('SELECT id, store, product, delta FROM outbox WHERE code = ? ORDER BY seq', [team])))?.rows ?? []).map(
    ([id, store, product, delta]) => ({ id: String(id), store: String(store), product: String(product), delta: Number(delta) }),
  );

// Sends waiting changes, oldest first, each with its ID so a resend after a lost reply counts once.
// Stops at the first one the network doesn't carry; a change the server refuses (its store or product
// was removed) is dropped, and its reason returned.
async function flush(storage: Storage, team: string): Promise<string> {
  let refused = '';
  for (const q of await queued(storage, team)) {
    const res = await request(team, '/adjust', {
      method: 'POST',
      body: JSON.stringify({ storeId: Number(q.store), productId: Number(q.product), delta: q.delta, changeId: q.id }),
    }).catch((e) => {
      if (unreachable(e)) return undefined;
      throw e;
    });
    if (!res || res.status >= 500 || res.status === 401) break; // try again later
    if (!res.ok) refused = String(((await res.json().catch(() => ({}))) as { error?: unknown }).error ?? 'The server refused a change.');
    await outbox(storage, (db) => db.execute('DELETE FROM outbox WHERE id = ?', [q.id]));
  }
  return refused;
}

const sources: Sources = {
  whichHost: async () => ({ web: exactHost() === 'web' }),
  checkCode: async ([code]) => {
    const reply = await write(code, '/stores', { method: 'GET' });
    return reply.ok || reply.error !== 'Wrong team code.' ? reply : { ok: false, error: 'Wrong team code.' };
  },
  loadStores: ([code], _kept, storage) => names(code, 'stores', storage),
  loadProducts: ([code], _kept, storage) => names(code, 'products', storage),
  // The device's copy of this store's counts, with its waiting taps on top: sent first, so a reply
  // that brings the server's counts already includes them.
  loadStock: ([code, store], _kept, storage) =>
    serial(async (): Promise<Result<'loadStock'>> => {
      if (code === '' || store === '') return { store, lines: [], waiting: 0, offline: false, dropped: '' };
      // A tap the server refused while sending here is dropped; this answer says why, once.
      const dropped = await flush(storage, code);
      const got = await fromDevice(storage, `stock:${store}`, async (timeout) => {
        const body = (await read(code, `/stores/${encodeURIComponent(store)}/stock`, timeout)) ?? [];
        if (!body.every(isLine)) throw new Error('The server returned an invalid stock list.');
        return body.map((l) => ({ id: String(l.id), name: l.name, count: l.count }));
      });
      const waiting = await queued(storage, code);
      const lines = withTaps(got === 'denied' ? [] : got.value, waiting.filter((q) => q.store === store && !sending.has(q.id)));
      return { store, lines, waiting: waiting.length, offline: got !== 'denied' && got.offline, dropped };
    }),
  // Saved on the device first, then sent; a tap with no connection is kept and sent later.
  adjustStock: async ([code, store, product, delta], _kept, storage) => {
    const id = crypto.randomUUID();
    sending.add(id);
    try {
      const kept = await outbox(storage, (db) =>
        db.execute('INSERT INTO outbox (id, code, store, product, delta) VALUES (?, ?, ?, ?, ?)', [id, code, store, product, delta]),
      );
      if (!kept) return await write(code, '/adjust', { method: 'POST', body: JSON.stringify({ storeId: Number(store), productId: Number(product), delta }) });
      // Kept either way: a send that fails here goes out with the next one.
      const refused = await serial(() => flush(storage, code)).catch(() => '');
      return { ok: refused === '', error: refused };
    } finally {
      sending.delete(id);
    }
  },
  // Sign-out: this device keeps nothing of the team's, neither its lists nor its waiting taps.
  clearDevice: async (_args, _kept, storage) => {
    await outbox(storage, (db) => db.transaction([{ sql: 'DELETE FROM outbox' }, { sql: 'DELETE FROM seen' }]));
    return { ok: true, error: '' };
  },
  setStock: ([code, store, product, count]) =>
    write(code, '/set', { method: 'POST', body: JSON.stringify({ storeId: Number(store), productId: Number(product), count }) }),
  addName: async ([code, list, name]) =>
    isList(list) ? write(code, `/${list}`, { method: 'POST', body: JSON.stringify({ name }) }) : { ok: false, error: 'Invalid list.' },
  removeName: async ([code, list, id]) =>
    isList(list) ? write(code, `/${list}/${encodeURIComponent(id)}`, { method: 'DELETE' }) : { ok: false, error: 'Invalid list.' },
};
export const answer: Answer = (source, args, store, storage, native) => sources[source](args, store, storage, native);

// +/− and typed counts show at once; the server's answer replaces them once it has them.
type StockAnswer = Result<'loadStock'>;
export const overlay: Overlay = (source, args, answer, writes) => {
  if (source !== 'loadStock') return undefined;
  const [, store] = args as [string, string];
  const shown = answer as StockAnswer;
  let lines = shown.lines;
  for (const w of writes) {
    if (w.answered || (w.source !== 'adjustStock' && w.source !== 'setStock')) continue;
    const [, wStore, product, n] = w.args as [string, string, string, number];
    if (wStore !== store) continue;
    lines = lines.map((l) =>
      l.id !== product ? l : { ...l, count: w.source === 'setStock' ? n : Math.min(1_000_000, Math.max(0, l.count + n)) },
    );
  }
  return { ...shown, lines } as never;
};
