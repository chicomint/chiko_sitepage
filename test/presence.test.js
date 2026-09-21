import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { createPresenceServer } from '../server.js';

const historicalCsv = 'day,hits,views,bandwidth\n2026-09-19,25713,15218,1000\n';

async function fixture(t, options = {}) {
  let folder;
  let activeStatsCsv;
  if (options.statsCsvPath) {
    folder = mkdtempSync(join(tmpdir(), 'chicomint-server-csv-'));
    const csv = join(folder, 'stats.csv');
    copyFileSync(options.statsCsvPath, csv);
    activeStatsCsv = csv;
    options = { ...options, statsCsvPath: csv };
  }
  const app = createPresenceServer({ statsCsvPath: null, ...options });
  t.after(async () => {
    await app.close();
    if (folder) rmSync(folder, { recursive: true, force: true });
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  async function client({ token = '', page = '/', active = true, autoPong = true } = {}) {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/presence', { origin, autoPong });
    const messages = [];
    ws.on('message', raw => messages.push(JSON.parse(raw)));
    ws.on('error', () => {});
    const until = async (predicate) => {
      for (let i = 0; i < 200; i++) {
        const found = messages.find(predicate);
        if (found) return found;
        await delay(5);
      }
      assert.fail('Expected socket message was not received');
    };
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'hello', token, page, active }));
    const welcome = await until(m => m.type === 'welcome');
    return { ws, messages, until, token: welcome.token,
      send: (data) => ws.send(JSON.stringify(data)),
      reset: () => { messages.length = 0; },
      close: async () => { const closed = once(ws, 'close'); ws.close(); await closed; },
    };
  }
  return { ...app, origin, client, statsCsvPath: activeStatsCsv };
}

test('homepage records CSV visits by day and leaves unique visitors as live only', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'chicomint-html-stats-'));
  const csv = join(folder, 'stats.csv');
  writeFileSync(csv, historicalCsv);
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  let now = Date.UTC(2026, 8, 21, 12);
  const app = await fixture(t, { statsCsvPath: csv, statsOptions: { now: () => now } });
  const html = await (await fetch(app.origin)).text();
  assert.match(html, /data-presence-stat="visits"[^>]*>15,219</);
  assert.match(html, /<dt>Uniq\. Visitors:<\/dt><dd[^>]*>live only<\/dd>/);
  assert.match(html, /data-presence-stat="online"[^>]*>0</);
  const a = await app.client();
  await a.until(m => m.type === 'stats' && m.online === 1 && m.visits === 15219 && !('unique' in m));
  await fetch(app.origin);
  const repeated = await (await fetch(app.origin)).text();
  assert.match(repeated, /data-presence-stat="visits"[^>]*>15,219</);
  await fetch(app.origin + '/blogs.html');
  await fetch(app.origin + '/realtime.js');
  now += 3600000;
  await fetch(app.origin + '/blogs.html');
  await a.until(m => m.type === 'stats' && m.visits === 15220);
});

test('HTTP resources only add hits; trusted IPs use fixed windows on every HTML page', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'chicomint-ip-stats-'));
  const csv = join(folder, 'stats.csv');
  writeFileSync(csv, historicalCsv);
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  let now = Date.UTC(2026, 8, 21);
  const app = await fixture(t, { statsCsvPath: csv, statsTrustedProxies: ['127.0.0.1'],
    statsIpHeader: 'x-real-ip', statsOptions: { now: () => now } });
  const observer = await app.client();
  const get = (path, ip = '1.2.3.4', method = 'GET') => fetch(app.origin + path,
    { method, headers: { 'X-Real-IP': ip } }).then(r => r.arrayBuffer());
  await get('/realtime.js');
  await get('/style.css');
  await get('/health');
  await get('/', '1.2.3.4', 'HEAD');
  const first = await app.client();
  await first.until(m => m.type === 'stats' && m.visits === 15218 && m.hits === 25716);
  await get('/blogs.html');
  await observer.until(m => m.type === 'stats' && m.visits === 15219);
  await Promise.all(Array.from({ length: 20 }, () => get('/')));
  const second = await app.client();
  await second.until(m => m.type === 'stats' && m.visits === 15219 && m.hits === 25737);
  await get('/credits.html', '5.6.7.8');
  await observer.until(m => m.type === 'stats' && m.visits === 15220);
  now += 3599999;
  await get('/');
  now++;
  await get('/blogs.html');
  await observer.until(m => m.type === 'stats' && m.visits === 15221);
});

test('tabs, refreshes and reconnects do not inflate on-site visitors', async t => {
  const app = await fixture(t);
  const a = await app.client();
  const tab = await app.client({ token: a.token });
  const b = await app.client();
  assert.equal(tab.token, a.token);
  await b.until(m => m.type === 'stats' && m.online === 2);
  await tab.close();
  b.reset();
  await a.close();
  await b.until(m => m.type === 'stats' && m.online === 1);
  const refreshed = await app.client({ token: a.token });
  await refreshed.until(m => m.type === 'stats' && m.online === 2);
});

test('cursors use normalized coordinates, same-page peers, no self echo, snapshots and cleanup', async t => {
  const app = await fixture(t);
  const a = await app.client();
  const ownTab = await app.client({ token: a.token });
  const b = await app.client({ page: '/index.html' });
  const elsewhere = await app.client({ page: '/blogs.html' });
  for (const c of [a, ownTab, b, elsewhere]) c.reset();
  a.send({ type: 'cursor', id: 'impersonated', label: '<img onerror=alert(1)>', x: 0.25, y: 0.75 });
  const cursor = await b.until(m => m.type === 'cursor');
  assert.equal(cursor.x, 0.25);
  assert.equal(cursor.y, 0.75);
  assert.match(cursor.label, /^USER-\d+$/);
  assert.notEqual(cursor.id, 'impersonated');
  assert.equal((await ownTab.until(m => m.type === 'cursor')).id, cursor.id);
  for (const c of [a, elsewhere]) assert.equal(c.messages.some(m => m.type === 'cursor'), false);
  const newcomer = await app.client();
  const snapshot = await newcomer.until(m => m.type === 'snapshot');
  assert.equal(snapshot.peers[0].id, cursor.id);
  b.reset();
  a.send({ type: 'active', active: false });
  await delay(30);
  assert.equal(b.messages.some(m => m.type === 'leave'), false);
  const observer = await app.client({ token: a.token });
  assert.equal((await observer.until(m => m.type === 'snapshot')).peers[0].id, cursor.id);
  b.reset();
  await delay(45);
  a.send({ type: 'cursor', x: 0.5, y: 0.5 });
  await delay(30);
  assert.equal(b.messages.some(m => m.type === 'cursor'), false);
  a.send({ type: 'active', active: true });
  a.send({ type: 'cursor', x: -10, y: 100 });
  const clamped = await b.until(m => m.type === 'cursor');
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 1);
  b.reset();
  await a.close();
  await b.until(m => m.type === 'leave' && m.id === cursor.id);
});

test('forged identities, invalid coordinates and event floods are rejected', async t => {
  const app = await fixture(t);
  const a = await app.client();
  const forged = await app.client({ token: a.token.slice(0, 37) + '0'.repeat(64) });
  assert.notEqual(forged.token, a.token);
  forged.reset();
  a.send({ type: 'cursor', x: '0.5', y: 0.5 });
  a.send({ type: 'cursor', x: null, y: 0.5 });
  await delay(45);
  assert.equal(forged.messages.some(m => m.type === 'cursor'), false);
  for (let i = 0; i < 20; i++) a.send({ type: 'cursor', x: 0.5, y: 0.5 });
  await delay(45);
  assert.equal(forged.messages.filter(m => m.type === 'cursor').length, 1);
  const closed = once(a.ws, 'close');
  for (let i = 0; i < 100; i++) a.send({ type: 'cursor', x: 0.5, y: 0.5 });
  assert.equal((await closed)[0], 1008);
});

test('bad origins, binary/oversized frames and backend file access are blocked', async t => {
  const app = await fixture(t);
  const bad = new WebSocket(app.origin.replace('http:', 'ws:') + '/presence', { origin: 'https://evil.example' });
  bad.on('error', () => {});
  const [, response] = await once(bad, 'unexpected-response');
  assert.equal(response.statusCode, 403);
  bad.terminate();
  const binary = await app.client();
  const binaryClosed = once(binary.ws, 'close');
  binary.ws.send(Buffer.from('abc'));
  assert.equal((await binaryClosed)[0], 1008);
  const large = await app.client();
  const largeClosed = once(large.ws, 'close');
  large.ws.send('x'.repeat(2048));
  assert.equal((await largeClosed)[0], 1009);
  for (const path of ['/server.js', '/database.js', '/data/visitors.sqlite', '/package.json', '/.env', '/node_modules/ws/package.json', '/media/../database.js']) {
    assert.equal((await fetch(app.origin + path)).status, 404, path);
  }
  for (const path of ['/', '/health', '/math/', '/d/', '/realtime.js', '/media/miku-miku-oo-ee-oo/Normal_96.gif']) {
    const response = await fetch(app.origin + path);
    assert.equal(response.status, 200, path);
    await response.arrayBuffer();
  }
});

test('heartbeat removes a silently lost visitor', async t => {
  const app = await fixture(t, { heartbeatMs: 40 });
  const observer = await app.client();
  const stale = await app.client({ autoPong: false });
  await observer.until(m => m.type === 'stats' && m.online === 2);
  const closed = once(stale.ws, 'close');
  await closed;
  await observer.until(m => m.type === 'stats' && m.online === 1);
});
