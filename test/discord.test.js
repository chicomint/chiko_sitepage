import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { connectDatabase } from '../cms/database.js';
import { createDiscordTracker, nextPresence, DISCORD_ID } from '../discord-presence.js';
const data = status => ({ discord_status: status, discord_user: { id: DISCORD_ID, username: 'Test user', avatar: 'abc123' } });
test('duration starts only at a transition observed on a continuous stream', () => {
  let state = nextPresence(null, data('online'), 10000); assert.equal(state.since, null);
  for (const status of ['idle', 'dnd', 'offline', 'online']) {
    state = nextPresence(state, data(status), 20000, true, true); assert.equal(state.since.getTime(), 20000); assert.equal(state.status, status);
    state = nextPresence(state, data(status), 25000, true, true); assert.equal(state.since.getTime(), 20000);
  }
  state = nextPresence(state, data('idle'), 30000, false, false); assert.equal(state.since, null);
  assert.throws(() => nextPresence(state, data('invalid'), 30000));
});
test('Lanyard socket transitions persist; gaps and polling never fabricate duration', { timeout: 30000 }, async () => {
  const store = await connectDatabase('mongodb://127.0.0.1:27017/discord_test_' + randomBytes(8).toString('hex'));
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(resolve => server.on('listening', resolve));
  let current, clock = 10000, tracker;
  let pollingStatus = 'online', pollFails = false;
  const send = (t, status) => current.send(JSON.stringify({ op: 0, t, d: data(status) }));
  server.on('connection', ws => { current = ws; ws.send(JSON.stringify({ op: 1, d: { heartbeat_interval: 30000 } })); ws.on('message', bytes => { if (JSON.parse(bytes).op === 2) send('INIT_STATE', 'online'); }); });
  const config = { db: store.db, now: () => clock, socketUrl: 'ws://127.0.0.1:' + server.address().port, pollMs: 50,
    fetchPresence: async () => { if (pollFails) throw new Error('API unavailable'); return { ok: true, json: async () => ({ success: true, data: data(pollingStatus) }) }; } };
  async function until(predicate) { const deadline = Date.now() + 5000; while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 10)); } }
  try {
    tracker = await createDiscordTracker(config); await until(() => tracker.snapshot().available); assert.equal(tracker.snapshot().since, null); assert.equal('username' in tracker.snapshot(), false); assert.equal('avatar' in tracker.snapshot(), false);
    await new Promise(resolve => setTimeout(resolve, 50)); clock = 20000; send('PRESENCE_UPDATE', 'idle'); await until(() => tracker.snapshot().status === 'idle');
    assert.equal(tracker.snapshot().since.getTime(), 20000);
    assert.equal((await store.db.collection('discordPresence').findOne({ _id: DISCORD_ID })).since.getTime(), 20000);
    assert.equal(await store.db.collection('discordTransitions').countDocuments(), 1);
    clock = 30000; send('PRESENCE_UPDATE', 'idle'); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(tracker.snapshot().since.getTime(), 20000);
    pollingStatus = 'dnd'; current.close(); await until(() => tracker.snapshot().status === 'dnd'); assert.equal(tracker.snapshot().since, null);
    pollFails = true; await until(() => !tracker.snapshot().available); assert.equal(tracker.snapshot().since, null);
    pollFails = false;
    await tracker.close(); tracker = null;
    tracker = await createDiscordTracker(config); assert.equal(tracker.snapshot().since, null); assert.equal(tracker.snapshot().available, false);
    assert.equal(await store.db.collection('discordTransitions').countDocuments(), 1);
  } finally { await tracker?.close(); for (const ws of server.clients) ws.terminate(); await new Promise(resolve => server.close(resolve)); await store.db.dropDatabase(); await store.close(); }
});
