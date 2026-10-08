import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';

export const DISCORD_ID = '1002432256981352461';
const statuses = new Set(['online', 'idle', 'dnd', 'offline']);
export function nextPresence(previous, data, now, continuous = false, transition = false) {
  if (!data || !statuses.has(data.discord_status) || data.discord_user?.id !== DISCORD_ID) throw new Error('Invalid presence');
  const status = data.discord_status;
  const changed = previous?.status !== status;
  // INIT_STATE, polling and reconnections cannot establish historical starts.
  const since = continuous && transition && changed && previous?.status ? new Date(now) : continuous && !changed ? previous?.since || null : null;
  const user = data.discord_user;
  const avatar = /^[a-f0-9_]+$/.test(user.avatar || '') ? `https://cdn.discordapp.com/avatars/${DISCORD_ID}/${user.avatar}.png?size=64` : '/media/comment-avatar.svg';
  return { status, since, observedAt: new Date(now), username: String(user.username || 'chicomint').slice(0, 80), avatar, available: true };
}
export async function createDiscordTracker({ db, fetchPresence = fetch, Socket = WebSocket, now = Date.now,
  api = `https://api.lanyard.rest/v1/users/${DISCORD_ID}`, socketUrl = 'wss://api.lanyard.rest/socket', pollMs = 30000 } = {}) {
  const events = new EventEmitter(); events.setMaxListeners(0);
  const collection = db.collection('discordPresence');
  let state = await collection.findOne({ _id: DISCORD_ID });
  state = { ...(state || {}), since: null, available: false };
  await collection.updateOne({ _id: DISCORD_ID }, { $set: { since: null, available: false } }, { upsert: true });
  let socket, initialized = false, stopped = false, retry, heartbeat, watchdog, pollTimer, polling = false, revision = 0, queue = Promise.resolve();
  function snapshot() {
    return { userId: DISCORD_ID, status: state.status || null, since: state.available ? state.since : null,
      available: !!state.available, observedAt: state.observedAt || null, serverNow: now() };
  }
  function enqueue(work) {
    queue = queue.then(work).catch(() => {
      state = { ...state, since: null, available: false }; events.emit('change', snapshot());
      console.error(JSON.stringify({ event: 'discord_tracking_error' }));
    });
    return queue;
  }
  async function observe(data, continuous, transition, observed = now()) {
    const next = nextPresence(state, data, observed, continuous, transition);
    const changed = next.status !== state.status;
    // The current timestamp and transition history survive visitor refreshes.
    if (changed && next.since) await db.collection('discordTransitions').insertOne({ userId: DISCORD_ID, from: state.status, to: next.status, observedAt: next.since });
    await collection.updateOne({ _id: DISCORD_ID }, { $set: next }, { upsert: true });
    state = next; events.emit('change', snapshot());
  }
  function disconnect(current) {
    if (socket !== current) return;
    revision++; socket = null; initialized = false;
    clearInterval(heartbeat); clearTimeout(watchdog);
    enqueue(async () => { state = { ...state, since: null, available: false }; await collection.updateOne({ _id: DISCORD_ID }, { $set: { since: null, available: false } }); events.emit('change', snapshot()); });
    current.terminate();
    if (!stopped && !retry) retry = setTimeout(() => { retry = null; connect(); }, 10000);
    if (!stopped) void poll();
  }
  function connect() {
    if (stopped) return;
    const current = socket = new Socket(socketUrl, { handshakeTimeout: 10000, maxPayload: 256 * 1024 });
    let alive = true;
    watchdog = setTimeout(() => disconnect(current), 15000);
    current.on('pong', () => { alive = true; });
    current.on('message', bytes => {
      if (socket !== current) return;
      let message;
      try { message = JSON.parse(bytes.toString()); } catch { disconnect(current); return; }
      if (message.op === 1) {
        const interval = Number(message.d?.heartbeat_interval);
        if (!Number.isFinite(interval) || interval < 1000 || interval > 120000) return disconnect(current);
        clearInterval(heartbeat);
        heartbeat = setInterval(() => {
          if (!alive) return disconnect(current);
          alive = false;
          if (current.readyState === Socket.OPEN) { current.send(JSON.stringify({ op: 3 })); current.ping(); }
        }, interval);
        current.send(JSON.stringify({ op: 2, d: { subscribe_to_id: DISCORD_ID } }));
      } else if (message.op === 0 && ['INIT_STATE', 'PRESENCE_UPDATE'].includes(message.t)) {
        const data = message.d?.[DISCORD_ID] || message.d;
        if (!statuses.has(data?.discord_status) || data.discord_user?.id !== DISCORD_ID) return disconnect(current);
        const continuous = initialized, transition = message.t === 'PRESENCE_UPDATE';
        revision++; initialized = true; clearTimeout(watchdog);
        const observed = now();
        enqueue(() => observe(data, continuous, transition, observed));
      }
    });
    current.on('error', () => disconnect(current));
    current.on('close', () => disconnect(current));
  }
  async function poll() {
    if (stopped || initialized || polling) return;
    polling = true; const version = revision;
    try {
      const response = await fetchPresence(api, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Lanyard unavailable');
      const payload = await response.json();
      if (!payload.success) throw new Error('Lanyard unavailable');
      if (!stopped && version === revision && !initialized) await enqueue(() => observe(payload.data, false, false));
    } catch {
      if (!stopped && version === revision && !initialized) await enqueue(async () => { state = { ...state, since: null, available: false }; await collection.updateOne({ _id: DISCORD_ID }, { $set: { since: null, available: false } }); events.emit('change', snapshot()); });
    } finally { polling = false; }
  }
  connect(); void poll(); pollTimer = setInterval(poll, pollMs);
  return { snapshot, subscribe(listener) { events.on('change', listener); return () => events.off('change', listener); },
    async close() { stopped = true; clearTimeout(retry); clearTimeout(watchdog); clearInterval(heartbeat); clearInterval(pollTimer); socket?.terminate(); socket = null; await queue; } };
}
