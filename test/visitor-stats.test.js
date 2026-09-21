import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { visitorStats, VISIT_WINDOW } from '../visitor-stats.js';
import { clientIpResolver, normalizeIp } from '../client-ip.js';

test('fixed one-hour windows, separate hits, restart persistence and Bangkok rollover', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'visit-windows-'));
  const csv = join(folder, 'stats.csv');
  writeFileSync(csv, 'day,hits,views,bandwidth\n2026-09-19,20,10,100\n');
  let now = Date.UTC(2026, 8, 21, 16, 30);
  let stats = visitorStats(csv, { now: () => now });
  try {
    assert.equal(stats.record('1.2.3.4', false), false);
    assert.equal(stats.record('1.2.3.4', true), true);
    for (let i = 0; i < 20; i++) assert.equal(stats.record('1.2.3.4', true), false);
    assert.equal(stats.record('1.2.3.5', true), true);
    assert.deepEqual(stats.counts(), { visits: 12, hits: 43 });
    now += VISIT_WINDOW - 1;
    assert.equal(stats.record('1.2.3.4', true), false);
    await stats.close();
    stats = visitorStats(csv, { now: () => now });
    assert.equal(stats.record('1.2.3.4', true), false);
    now++;
    assert.equal(stats.record('1.2.3.4', true), true);
    await stats.flush();
    assert.match(readFileSync(csv, 'utf8'), /2026-09-22,3,1,0/);
    assert.equal(JSON.parse(readFileSync(csv + '.sessions.json')).sessions.length, 1);
    assert.ok(!readFileSync(csv + '.sessions.json', 'utf8').includes('1.2.3.4'));
    now += VISIT_WINDOW;
    await stats.flush();
    assert.equal(JSON.parse(readFileSync(csv + '.sessions.json')).sessions.length, 0);
  } finally { await stats.close(); rmSync(folder, { recursive: true }); }
});

test('capacity does not evict active sessions and recount them', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'visit-cap-'));
  const csv = join(folder, 'stats.csv');
  writeFileSync(csv, 'day,hits,views,bandwidth\n');
  let now = 0;
  const stats = visitorStats(csv, { now: () => now, maxSessions: 1 });
  try {
    assert.equal(stats.record('a', true), true);
    assert.equal(stats.record('b', true), false);
    assert.equal(stats.record('a', true), false);
    now += VISIT_WINDOW;
    assert.equal(stats.record('b', true), true);
  } finally { await stats.close(); rmSync(folder, { recursive: true }); }
});

test('proxy trust, spoofed headers, IPv6 normalization and multi-hop chains', () => {
  const req = (peer, headers) => ({ socket: { remoteAddress: peer }, headers });
  const direct = clientIpResolver();
  assert.equal(direct(req('1.2.3.4', { 'x-forwarded-for': '5.6.7.8' })), '1.2.3.4');
  assert.equal(normalizeIp('::ffff:1.2.3.4'), '1.2.3.4');
  assert.equal(normalizeIp('2001:0db8:0:0:0:0:0:1'), '2001:db8::1');
  const forwarded = clientIpResolver({ trustedProxies: ['10.0.0.0/8'] });
  assert.equal(forwarded(req('10.0.0.1', { 'x-forwarded-for': '8.8.8.8, 1.2.3.4, 10.0.0.2' })), '1.2.3.4');
  assert.equal(forwarded(req('10.0.0.1', { 'x-forwarded-for': 'invalid' })), null);
  for (const header of ['x-real-ip', 'cf-connecting-ip']) {
    const resolve = clientIpResolver({ trustedProxies: ['10.0.0.1'], header });
    assert.equal(resolve(req('10.0.0.1', { [header]: '1.2.3.4' })), '1.2.3.4');
    assert.equal(resolve(req('10.0.0.1', {})), null);
    assert.equal(resolve(req('10.0.0.1', { [header]: '1.2.3.4, 5.6.7.8' })), null);
    assert.equal(resolve(req('10.0.0.2', { [header]: '1.2.3.4' })), '10.0.0.2');
  }
});
