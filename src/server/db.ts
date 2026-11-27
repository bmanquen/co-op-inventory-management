// The web (HTTP) client is the one that runs in Expo Hosting's Workers runtime.
import { createClient } from "@libsql/client/web";

let client: ReturnType<typeof createClient> | undefined;
// Created on first request: Expo Hosting loads this module at deploy time, before env vars exist.
export const db = () => {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set on the server");
  return (client ??= createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }));
};

// The tables, for Expo Hosting (below) and server.ts alike, so tests run on production's schema.
// AUTOINCREMENT so a deleted store's or product's ID is never reused by a new one.
// No foreign keys: Turso's HTTP connections don't keep PRAGMA foreign_keys, so the API checks references itself.
export const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS stores (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)",
  `CREATE TABLE IF NOT EXISTS stock (
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    count INTEGER NOT NULL CHECK (count >= 0),
    PRIMARY KEY (store_id, product_id)
  )`,
  // Each +/− a device queued, by the ID it made: a resend is applied once. Also the stock history.
  `CREATE TABLE IF NOT EXISTS stock_changes (
    id TEXT PRIMARY KEY,
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    delta INTEGER NOT NULL,
    at INTEGER NOT NULL
  )`,
];

let schema: Promise<unknown> | undefined;
// Create tables once per server instance; a failed attempt is retried on the next request.
export const ready = () =>
  (schema ??= db()
    .batch(SCHEMA, "write")
    .catch((e) => {
      schema = undefined;
      throw e;
    }));
