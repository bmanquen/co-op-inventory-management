// tools/backup.ts copies every row and keeps AUTOINCREMENT's counters, so a restore never reuses an ID.
import { createClient } from '@libsql/client';
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA } from '../src/server/db.ts';

test('a backup has every row and the next ID', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'backup-'));
  const src = createClient({ url: `file:${join(dir, 'src.db')}` });
  await src.batch(
    [
      ...SCHEMA,
      "INSERT INTO stores (name) VALUES ('Downtown'), ('It''s North')",
      "INSERT INTO products (name) VALUES ('Beans'), ('Gone')",
      'DELETE FROM products WHERE id = 2',
      'INSERT INTO stock VALUES (1, 1, 7), (2, 1, 0)',
    ],
    'write',
  );

  const run = Bun.spawnSync(['bun', join(import.meta.dir, 'backup.ts'), join(dir, 'out.db')], {
    env: { ...process.env, TURSO_DATABASE_URL: `file:${join(dir, 'src.db')}`, TURSO_AUTH_TOKEN: '' },
  });
  expect(run.stderr.toString()).toBe('');

  const out = createClient({ url: `file:${join(dir, 'out.db')}` });
  const rows = async (sql: string) => (await out.execute(sql)).rows.map((r) => Array.from({ length: r.length }, (_, i) => r[i]));
  expect(await rows('SELECT id, name FROM stores ORDER BY id')).toEqual([[1, 'Downtown'], [2, "It's North"]]);
  expect(await rows('SELECT store_id, product_id, count FROM stock ORDER BY store_id')).toEqual([[1, 1, 7], [2, 1, 0]]);
  // Product 2 was deleted, so the next one must be 3, not 2.
  await out.execute("INSERT INTO products (name) VALUES ('New')");
  expect(await rows('SELECT id FROM products ORDER BY id')).toEqual([[1], [3]]);
});
