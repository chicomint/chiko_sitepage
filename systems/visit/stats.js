import { readFileSync, existsSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';

export const VISIT_WINDOW = 60 * 60 * 1000;
const dayOf = time => new Date(time + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);

export function visitorStats(filename, { now = Date.now, maxSessions = 100000 } = {}) {
  if (!filename) return { counts: () => ({ visits: null, hits: null }), record: () => false, close: async () => {}, flush: async () => {} };
  const header = 'day,hits,views,bandwidth';
  const [columns, ...lines] = readFileSync(filename, 'utf8').trim().split(/\r?\n/);
  if (columns !== header) throw new Error('Unexpected stats CSV columns');
  const rows = new Map();
  for (const line of lines.filter(Boolean)) {
    const [day, ...values] = line.split(',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || rows.has(day) || values.length !== 3 ||
        !values.every(v => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)))) throw new Error('Invalid stats CSV row');
    rows.set(day, values.map(Number));
  }
  const sessionsPath = `${filename}.sessions.json`;
  let secret = randomBytes(32).toString('hex');
  const sessions = new Map();
  if (existsSync(sessionsPath)) {
    const saved = JSON.parse(readFileSync(sessionsPath, 'utf8'));
    if (!/^[a-f0-9]{64}$/.test(saved.secret) || !Array.isArray(saved.sessions)) throw new Error('Invalid visit sessions');
    secret = saved.secret;
    for (let [key, expires] of saved.sessions.sort((a, b) => a[1] - b[1])) {
      if (!/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(expires)) throw new Error('Invalid visit session');
      expires = Math.floor(expires / VISIT_WINDOW) * VISIT_WINDOW;
      if (expires > now() && sessions.size < maxSessions) sessions.set(key, expires);
    }
  }
  let visits = 0, hits = 0, dirty = false;
  for (const row of rows.values()) { hits += row[0]; visits += row[1]; }
  if (![hits, visits].every(Number.isSafeInteger)) throw new Error('Invalid stats totals');
  function expire(time) {
    // Insertion order follows fixed expiry order; repeats never move the deadline.
    for (const [key, expires] of sessions) {
      if (expires > time) break;
      sessions.delete(key);
      dirty = true;
    }
  }
  let writing = Promise.resolve();
  async function atomic(path, content) {
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, content);
    await rename(temporary, path);
  }
  function flush() {
    writing = writing.catch(() => {}).then(async () => {
      expire(now());
      if (!dirty) return;
      const csv = header + '\n' + [...rows].sort(([a], [b]) => a.localeCompare(b))
        .map(([day, row]) => `${day},${row.join(',')}`).join('\n') + '\n';
      const state = JSON.stringify({ secret, sessions: [...sessions] });
      dirty = false;
      try {
        await atomic(filename, csv);
        await atomic(sessionsPath, state);
      } catch (error) { dirty = true; throw error; }
    });
    return writing;
  }
  const timer = setInterval(() => { void flush().catch(error => console.error('Stats save failed:', error.message)); }, 30000);
  timer.unref();
  return {
    counts: () => ({ visits, hits }),
    record(ip, page) {
      const time = now();
      expire(time);
      const day = dayOf(time);
      if (!rows.has(day)) rows.set(day, [0, 0, 0]);
      const row = rows.get(day);
      row[0]++; hits++; dirty = true;
      if (!page || !ip) return false;
      const key = createHmac('sha256', secret).update(ip).digest('hex');
      if (sessions.has(key)) return false;
      // Do not evict live windows: doing so would recount returning visitors.
      if (sessions.size >= maxSessions) return false;
      sessions.set(key, (Math.floor(time / VISIT_WINDOW) + 1) * VISIT_WINDOW);
      row[1]++; visits++;
      return true;
    },
    flush,
    async close() { clearInterval(timer); await flush(); },
  };
}
