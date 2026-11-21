import type { Answer, Overlay, Result, Sources } from './app.contract.d.ts';

// The server's address, fixed at build: API_BASE_URL for a deploy (Expo Hosting's /api, see
// scripts/build-web.sh), else the local server.ts, which listens on it.
export const API = import.meta.env.API_BASE_URL ?? 'http://127.0.0.1:8787';
export const grants = `net.fetch ${API}`;

type Row = { id: number; name: string; out: number; low: number };
type Line = { id: number; name: string; count: number };
const isRow = (v: unknown): v is Row =>
  v !== null && typeof v === 'object' && Number.isSafeInteger((v as Row).id) && typeof (v as Row).name === 'string' &&
  Number.isInteger((v as Row).out) && Number.isInteger((v as Row).low);
const isLine = (v: unknown): v is Line =>
  v !== null && typeof v === 'object' && Number.isSafeInteger((v as Line).id) && typeof (v as Line).name === 'string' && Number.isInteger((v as Line).count);

// The team code travels as a bearer token on every request.
const request = (code: string, path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, { ...init, exactTimeout: 10000, headers: { authorization: `Bearer ${code}`, 'content-type': 'application/json' } });

// A read: undefined when the code was refused, so the screen can ask for it again.
async function read(code: string, path: string): Promise<unknown[] | undefined> {
  const res = await request(code, path);
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

async function names(code: string, list: 'products' | 'stores'): Promise<Result<'loadStores'>> {
  if (code === '') return { code, denied: false, items: [] };
  const body = await read(code, `/${list}`);
  if (!body) return { code, denied: true, items: [] };
  if (!body.every(isRow)) throw new Error('The server returned an invalid list.');
  return { code, denied: false, items: body.map((r) => ({ id: String(r.id), name: r.name, out: r.out, low: r.low })) };
}

const isList = (list: string): list is 'products' | 'stores' => list === 'products' || list === 'stores';

const sources: Sources = {
  checkCode: async ([code]) => {
    const reply = await write(code, '/stores', { method: 'GET' });
    return reply.ok || reply.error !== 'Wrong team code.' ? reply : { ok: false, error: 'Wrong team code.' };
  },
  loadStores: ([code]) => names(code, 'stores'),
  loadProducts: ([code]) => names(code, 'products'),
  loadStock: async ([code, store]): Promise<Result<'loadStock'>> => {
    if (code === '' || store === '') return { store, lines: [] };
    const body = (await read(code, `/stores/${encodeURIComponent(store)}/stock`)) ?? [];
    if (!body.every(isLine)) throw new Error('The server returned an invalid stock list.');
    return { store, lines: body.map((l) => ({ id: String(l.id), name: l.name, count: l.count })) };
  },
  adjustStock: ([code, store, product, delta]) =>
    write(code, '/adjust', { method: 'POST', body: JSON.stringify({ storeId: Number(store), productId: Number(product), delta }) }),
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
