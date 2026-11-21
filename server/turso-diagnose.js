// When Turso rejects a request, @libsql/client hides the reason. This asks Turso directly
// (HTTP pipeline API) and prints the server's own explanation, statement by statement.
import { schemaStatements } from './db.js';

async function call(base, token, sql) {
  const res = await fetch(`${base}/v2/pipeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql } }, { type: 'close' }] }),
  });
  const text = await res.text();
  let error = null;
  try {
    const j = JSON.parse(text);
    const r = j.results?.[0];
    if (r?.type === 'error') error = r.error?.message || JSON.stringify(r.error);
  } catch { /* not JSON */ }
  return { status: res.status, body: text.slice(0, 400), error };
}

export async function diagnoseTurso(url, token) {
  const base = 'https://' + url.replace(/^\w+:\/\//, '').split(/[/?]/)[0];
  const log = (s) => console.error('  [check] ' + s);
  try {
    const ping = await call(base, token, 'SELECT 1');
    log(`SELECT 1 -> HTTP ${ping.status}${ping.error ? ' error: ' + ping.error : ''}`);
    const parts = (token || '').split('.');
    log(`Token: ${token ? `${token.length} characters, ${parts.length === 3 ? 'looks like a database token' : 'does NOT look like a Turso database token'}` : 'missing'}`);
    if (ping.status !== 200 || ping.error) { log(`Turso says: ${ping.body}`); return; }
    for (const sql of [...schemaStatements(false), "SELECT name FROM pragma_table_info('daily_completions')"]) {
      const r = await call(base, token, sql);
      const label = sql.replace(/\s+/g, ' ').slice(0, 60);
      if (r.status !== 200 || r.error) {
        log(`FAILED: ${label}…`);
        log(`Turso says (HTTP ${r.status}): ${r.error || r.body}`);
        return;
      }
    }
    log('All setup statements were accepted when sent one at a time.');
  } catch (e) {
    log(`Could not reach Turso: ${e.message}`);
  }
}
