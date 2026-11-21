// Database access. Works with a local SQLite file (development, tests, self-hosting)
// or a hosted Turso/libSQL database (free hosting where the server's disk is not kept).
//
//   DATABASE_URL=file:var/baqara.db                       (default)
//   DATABASE_URL=libsql://your-db.turso.io  DATABASE_AUTH_TOKEN=...
import { createClient } from '@libsql/client';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

const clean = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? Number(a) : a));

export class Db {
  constructor(conn) {
    this.conn = conn;
  }
  async all(sql, ...args) {
    const r = await this.conn.execute({ sql, args: clean(args) });
    return r.rows.map((row) => Object.fromEntries(r.columns.map((c) => [c, row[c]])));
  }
  async get(sql, ...args) {
    return (await this.all(sql, ...args))[0];
  }
  async run(sql, ...args) {
    const r = await this.conn.execute({ sql, args: clean(args) });
    return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid) };
  }
  /** Run fn(txDb) inside a write transaction. */
  async tx(fn) {
    if (!this.conn.transaction) return fn(this); // already inside a transaction
    const t = await this.conn.transaction('write');
    try {
      const r = await fn(new Db(t));
      await t.commit();
      return r;
    } catch (e) {
      await t.rollback().catch(() => {});
      throw e;
    } finally {
      t.close();
    }
  }
  close() {
    this.conn.close?.();
  }
}

/** Split schema.sql into single statements (comments removed). */
export function schemaStatements(includePragmas) {
  return SCHEMA.replace(/--[^\n]*/g, '')
    .split(/;\s*(?:\n|$)/)
    .map((x) => x.trim())
    .filter((x) => x && (includePragmas || !/^PRAGMA/i.test(x)));
}

/** Tidy a pasted setting: remove quotes, a leading "Bearer", spaces and line breaks. */
export function cleanSetting(v) {
  if (!v) return v;
  return String(v).trim().replace(/^["'`]+|["'`]+$/g, '').replace(/^Bearer\s+/i, '').replace(/\s+/g, '');
}

export async function openDb(url = process.env.DATABASE_URL || 'file:var/baqara.db', authToken = process.env.DATABASE_AUTH_TOKEN) {
  url = cleanSetting(url);
  const local = url.startsWith('file:');
  if (local) mkdirSync(path.dirname(path.resolve(url.slice(5))), { recursive: true });
  // For Turso, talk plain HTTPS (most compatible with hosts and proxies) instead of WebSockets.
  const connectUrl = url.startsWith('libsql://') ? 'https://' + url.slice('libsql://'.length) : url;
  const client = createClient({ url: connectUrl, authToken: cleanSetting(authToken) || undefined });
  if (local) await client.execute('PRAGMA journal_mode = WAL').catch(() => {});
  // Create tables one statement at a time (PRAGMAs are local-file settings only).
  await client.batch(schemaStatements(local), 'write');
  // Columns added after the first release (CREATE TABLE IF NOT EXISTS does not add them to old tables).
  const cols = (await client.execute("SELECT name FROM pragma_table_info('daily_completions')")).rows.map((r) => r.name);
  if (!cols.includes('prev_state')) await client.execute('ALTER TABLE daily_completions ADD COLUMN prev_state TEXT');
  return new Db(client);
}

/** Remove a person and everything that belongs to them (explicit, so it does not depend on FK enforcement). */
export async function deleteUserData(db, userId) {
  await db.tx(async (t) => {
    for (const table of ['sessions', 'invitations', 'reading_plans', 'reading_progress', 'daily_completions', 'bookmarks',
      'reflections', 'reminders', 'push_subscriptions', 'family_memberships']) {
      await t.run(`DELETE FROM ${table} WHERE user_id = ?`, userId);
    }
    await t.run('DELETE FROM users WHERE id = ?', userId);
  });
}
