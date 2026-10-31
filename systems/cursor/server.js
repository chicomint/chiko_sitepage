import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { canonicalPath } from '../site/urls.js';

export function createCursorServer({ server, allowedOrigins = [], heartbeatMs = 15000, counts, publicPage }) {
  const identitySecret = randomBytes(32);
  const online = new Map();
  let nextLabel = 1;
  const sign = (id) => createHmac('sha256', identitySecret).update(id).digest('hex');
  function identity(token) {
    if (typeof token === 'string' && /^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token)) {
      const [id, signature] = token.split('.');
      if (timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(id), 'hex'))) return id;
    }
    return randomUUID();
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    let originOK = false;
    try {
      const origin = new URL(req.headers.origin);
      originOK = allowedOrigins.length ? allowedOrigins.includes(origin.origin) :
        ['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host;
    } catch { /* Missing and malformed origins are rejected. */ }
    if (req.url !== '/presence' || !originOK || wss.clients.size >= 1000) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });
  function send(ws, message) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 65536) { ws.terminate(); return; }
    ws.send(JSON.stringify(message));
  }
  const stats = () => ({ type: 'stats', ...counts(), online: online.size });
  function broadcastStats() {
    const message = stats();
    for (const ws of wss.clients) if (ws.visitor) send(ws, message);
  }
  function broadcastPeer(source, message) {
    const encoded = JSON.stringify(message);
    for (const ws of wss.clients) {
      if (ws.visitor && ws !== source && ws.page === source.page && ws.active && ws.readyState === WebSocket.OPEN) {
        if (ws.bufferedAmount > 65536) ws.terminate();
        else ws.send(encoded);
      }
    }
  }
  function hide(ws) {
    clearTimeout(ws.cursorTimer);
    ws.cursorTimer = null;
    ws.pendingCursor = null;
    if (!ws.position) return;
    ws.position = null;
    broadcastPeer(ws, { type: 'leave', id: ws.id });
  }
  function snapshot(ws) {
    const peers = [];
    for (const other of wss.clients) {
      if (other.visitor && other !== ws && other.page === ws.page && other.position) {
        peers.push({ id: other.id, label: other.label, ...other.position });
      }
    }
    send(ws, { type: 'snapshot', peers });
  }
  wss.on('connection', (ws) => {
    ws.id = randomUUID();
    ws.alive = true;
    ws.active = false;
    ws.lastCursor = 0;
    function flushCursor() {
      ws.cursorTimer = null;
      if (!ws.pendingCursor || !ws.active || ws.readyState !== WebSocket.OPEN) return;
      ws.lastCursor = Date.now();
      ws.position = ws.pendingCursor;
      ws.pendingCursor = null;
      broadcastPeer(ws, { type: 'cursor', id: ws.id, label: ws.label, ...ws.position });
    }
    let tokens = 60;
    let lastRefill = Date.now();
    const helloTimeout = setTimeout(() => ws.terminate(), 5000);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('message', (raw, binary) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      tokens = Math.min(60, tokens + (now - lastRefill) * 0.04);
      lastRefill = now;
      if (--tokens < 0) { ws.close(1008, 'Too many messages'); return; }
      let message;
      try { if (binary) throw new Error(); message = JSON.parse(raw.toString()); }
      catch { ws.close(1008, 'Invalid message'); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { ws.close(1008, 'Invalid message'); return; }
      if (!ws.visitor) {
        if (message.type !== 'hello' || typeof message.page !== 'string' ||
            !publicPage(message.page) ||
            typeof message.active !== 'boolean') { ws.close(1008, 'Invalid hello'); return; }
        const visitor = identity(message.token);
        ws.visitor = visitor;
        ws.page = canonicalPath(message.page);
        ws.active = message.active;
        clearTimeout(helloTimeout);
        if (!online.has(visitor)) online.set(visitor, { sockets: new Set() });
        const group = online.get(visitor);
        group.sockets.add(ws);
        ws.label = `USER-${String(nextLabel++).padStart(2, '0')}`;
        send(ws, { type: 'welcome', token: `${visitor}.${sign(visitor)}` });
        if (ws.active) snapshot(ws);
        broadcastPeer(ws, { type: 'join', id: ws.id, label: ws.label });
        broadcastStats();
        return;
      }
      if (message.type === 'cursor') {
        if (!ws.active || !Number.isFinite(message.x) || !Number.isFinite(message.y)) return;
        ws.pendingCursor = { x: Math.max(0, Math.min(1, message.x)), y: Math.max(0, Math.min(1, message.y)) };
        if (!ws.cursorTimer) {
          const remaining = 30 - (now - ws.lastCursor);
          if (remaining <= 0) flushCursor();
          else ws.cursorTimer = setTimeout(flushCursor, remaining);
        }
      } else if (message.type === 'ping') {
        send(ws, { type: 'pong' });
      } else if (message.type === 'hide') hide(ws);
      else if (message.type === 'active' && typeof message.active === 'boolean') {
        if (ws.active === message.active) return;
        ws.active = message.active;
        if (!ws.active) {
          clearTimeout(ws.cursorTimer);
          ws.cursorTimer = null;
          ws.pendingCursor = null;
        }
        // Inactive tabs keep their last position but cannot broadcast movement.
        if (ws.active) snapshot(ws);
      } else ws.close(1008, 'Invalid event');
    });
    ws.on('close', () => {
      clearTimeout(helloTimeout);
      if (!ws.visitor) return;
      hide(ws);
      const group = online.get(ws.visitor);
      group.sockets.delete(ws);
      if (!group.sockets.size) {
        online.delete(ws.visitor);
      }
      broadcastStats();
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, heartbeatMs);
  return { wss, onlineCount: () => online.size, broadcastStats, async close() {
    clearInterval(heartbeat);
    const closed = new Promise(done => wss.close(done));
    for (const ws of wss.clients) ws.terminate();
    await closed;
  } };
}
