import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function browser() {
  let time = 0, next = 1;
  const timers = new Map(), sockets = [], frames = [];
  class Target {
    listeners = new Map();
    addEventListener(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]); }
    emit(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn(event); }
  }
  class Socket extends Target {
    static OPEN = 1;
    static CLOSING = 2;
    readyState = 0;
    bufferedAmount = 0;
    sent = [];
    constructor() { super(); sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 2; } // Deliberately no close event: a stalled network.
    receive(data) { this.emit('message', { data: JSON.stringify(data) }); }
    open() { this.readyState = 1; this.emit('open'); }
  }
  const online = { textContent: '', title: '' };
  const window = new Target(), document = new Target();
  document.hidden = false;
  document.currentScript = { src: 'https://chiko.cc/realtime.js', hasAttribute: () => false };
  document.querySelectorAll = selector => selector.includes('online') ? [online] : [];
  document.createElement = () => ({ style: {}, setAttribute() {}, append() {}, remove() {} });
  document.body = { append() {} };
  let token = '';
  const timer = (fn, ms, repeat = false) => { const id = next++; timers.set(id, { fn, at: time + ms, ms, repeat }); return id; };
  vm.runInNewContext(readFileSync(new URL('../realtime.js', import.meta.url), 'utf8'), {
    window, document, navigator: {}, location: { href: 'https://chiko.cc/', pathname: '/' },
    URL, WebSocket: Socket, Image: class {}, innerWidth: 1000, innerHeight: 800,
    Date: { now: () => time }, performance: { now: () => time },
    localStorage: { getItem: () => token, setItem: (_, value) => { token = value; } },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    setTimeout: (fn, ms) => timer(fn, ms), clearTimeout: id => timers.delete(id),
    setInterval: (fn, ms) => timer(fn, ms, true), clearInterval: id => timers.delete(id),
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
  });
  async function advance(ms) {
    const end = time + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, entry] = due;
      time = entry.at;
      if (entry.repeat) entry.at += entry.ms; else timers.delete(id);
      entry.fn();
      await Promise.resolve(); await Promise.resolve();
    }
    time = end;
    await Promise.resolve();
  }
  function welcome(socket) {
    socket.open(); socket.receive({ type: 'welcome', token: 'signed-visitor' });
    socket.receive({ type: 'stats', online: 2 });
  }
  return { sockets, online, window, document, advance, welcome, frames };
}

test('stalled browser connections reconnect without waiting indefinitely for a close event', async () => {
  const b = browser();
  b.welcome(b.sockets[0]);
  await b.advance(10000);
  assert.equal(b.sockets[0].sent.at(-1).type, 'ping');
  await b.advance(32000);
  assert.equal(b.online.textContent, 'offline');
  assert.equal(b.sockets.length, 2);
  b.welcome(b.sockets[1]);
  assert.equal(b.sockets[1].sent[0].token, 'signed-visitor');
  assert.equal(b.online.textContent, '2');
  b.sockets[0].emit('close');
  assert.equal(b.online.textContent, '2');
});

test('a stalled initial handshake retries even when the browser never emits close', async () => {
  const b = browser();
  await b.advance(10000);
  assert.equal(b.sockets.length, 2);
  b.welcome(b.sockets[1]);
  assert.equal(b.online.textContent, '2');
});

test('heartbeat replies keep idle visitors connected and rendering waits for animation frames', async () => {
  const b = browser();
  const ws = b.sockets[0];
  b.welcome(ws);
  for (let i = 0; i < 6; i++) { await b.advance(10000); ws.receive({ type: 'pong' }); }
  assert.equal(b.sockets.length, 1);
  assert.equal(b.online.textContent, '2');
  ws.receive({ type: 'cursor', id: 'peer', label: 'USER-02', x: 0.2, y: 0.4 });
  ws.receive({ type: 'cursor', id: 'peer', label: 'USER-02', x: 0.3, y: 0.5 });
  assert.equal(b.frames.length, 1);
  b.window.emit('pagehide');
  await b.advance(60000);
  assert.equal(b.sockets.length, 1);
});
