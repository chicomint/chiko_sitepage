import { createServer } from 'node:http';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { createDrawingsApi } from './drawings-api.js';
import { visitorStats } from './visitor-stats.js';
import { clientIpResolver } from './client-ip.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.cur': 'image/x-icon',
  '.ani': 'application/octet-stream', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
  '.txt': 'text/plain', '.xml': 'application/xml', '.woff2': 'font/woff2' };

// Explicitly publish website files, never the whole project directory.
function publicFiles() {
  const files = new Map();
  const scan = (folder) => {
    for (const entry of readdirSync(join(ROOT, folder), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const relative = join(folder, entry.name);
      if (entry.isDirectory()) scan(relative);
      else if (entry.isFile() && TYPES[extname(entry.name)]) files.set('/' + relative, join(ROOT, relative));
    }
  };
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && !entry.name.startsWith('.') && /\.(html|css)$/.test(entry.name)) files.set('/' + entry.name, join(ROOT, entry.name));
  }
  for (const name of ['cursor.js', 'realtime.js', 'drawings.js', 'robots.txt', 'sitemap.xml']) files.set('/' + name, join(ROOT, name));
  for (const folder of ['media', 'picture', 'd', 'math']) scan(folder);
  return files;
}

export function createPresenceServer({
  allowedOrigins = [], heartbeatMs = 15000, statsCsvPath = join(ROOT, 'chicomint-stats.csv'),
  drawingsDirectory = join(ROOT, 'data/drawings'), drawingsTrustedProxies = [], drawingsOptions = {},
  statsTrustedProxies = [], statsIpHeader = 'x-forwarded-for', statsOptions = {} } = {}) {
  const clientIp = clientIpResolver({ trustedProxies: statsTrustedProxies, header: statsIpHeader });
  const visits = visitorStats(statsCsvPath, statsOptions);
  const identitySecret = randomBytes(32);
  const files = publicFiles();
  const drawingsRoute = createDrawingsApi({ directory: drawingsDirectory, allowedOrigins, trustedProxies: drawingsTrustedProxies, ...drawingsOptions });
  const online = new Map();
  let nextLabel = 1;
  const pageName = (path) => path.endsWith('/') ? path + 'index.html' : path;
  const sign = (id) => createHmac('sha256', identitySecret).update(id).digest('hex');
  function identity(token) {
    if (typeof token === 'string' && /^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token)) {
      const [id, signature] = token.split('.');
      if (timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(id), 'hex'))) return id;
    }
    return randomUUID();
  }
  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    let path;
    try { path = pageName(decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); }
    catch { res.writeHead(400).end(); return; }
    if (path === '/health') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('ok');
      return;
    }
    if (path === '/api/drawings' || path === '/api/drawings/config' || path.startsWith('/drawings/')) {
      if (req.method === 'GET' || req.method === 'HEAD') visits.record(null, false);
      void drawingsRoute(req, res, path);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const file = files.get(path);
    if (!file) { res.writeHead(404).end('Not found'); return; }
    const newVisit = visits.record(clientIp(req), req.method === 'GET' && extname(file) === '.html');
    if (newVisit) broadcastStats();
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') { res.end(); return; }
    if (path === '/index.html') {
      const totals = { online: online.size };
      const visitTotal = visits.counts().visits;
      if (visitTotal !== null) totals.visits = visitTotal;
      let html = readFileSync(file, 'utf8');
      for (const [name, value] of Object.entries(totals)) {
        html = html.replace(new RegExp(`(data-presence-stat="${name}"[^>]*>)[^<]*`),
          (_, opening) => opening + value.toLocaleString('en-US'));
      }
      res.end(html);
      return;
    }
    const stream = createReadStream(file);
    stream.on('error', () => { if (!res.headersSent) res.writeHead(404); res.end(); });
    stream.pipe(res);
  });
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
  const stats = () => ({ type: 'stats', ...visits.counts(), online: online.size });
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
            !files.has(pageName(message.page)) || !pageName(message.page).endsWith('.html') ||
            typeof message.active !== 'boolean') { ws.close(1008, 'Invalid hello'); return; }
        const visitor = identity(message.token);
        ws.visitor = visitor;
        ws.page = pageName(message.page);
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
  return { server, wss, async close() {
    clearInterval(heartbeat);
    const closed = new Promise((done) => wss.close(done));
    for (const ws of wss.clients) ws.terminate();
    await closed;
    await new Promise((done) => server.close(done));
    await visits.close();
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.RAILWAY_ENVIRONMENT_ID && !process.env.STATS_TRUSTED_PROXIES) {
    console.warn('Visit statistics: configure STATS_TRUSTED_PROXIES and STATS_IP_HEADER for the verified Railway proxy; otherwise visits use the socket IP.');
  }
  const dataDirectory = process.env.DATA_DIRECTORY || '';
  const statsCsvPath = process.env.STATS_CSV_PATH || (dataDirectory ? join(dataDirectory, 'chicomint-stats.csv') : join(ROOT, 'chicomint-stats.csv'));
  if (!existsSync(statsCsvPath)) {
    mkdirSync(dirname(statsCsvPath), { recursive: true });
    copyFileSync(join(ROOT, 'chicomint-stats.csv'), statsCsvPath);
  }
  const app = createPresenceServer({
    statsCsvPath,
    statsTrustedProxies: (process.env.STATS_TRUSTED_PROXIES || '').split(',').map(s => s.trim()).filter(Boolean),
    statsIpHeader: process.env.STATS_IP_HEADER || 'x-forwarded-for',
    allowedOrigins: (process.env.SITE_ORIGIN || process.env.ALLOWED_ORIGINS || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')).split(',').map(s => s.trim()).filter(Boolean),
    drawingsDirectory: process.env.DRAWINGS_DIRECTORY || (dataDirectory ? join(dataDirectory, 'drawings') : join(ROOT, 'data/drawings')),
    drawingsOptions: {
      maxDrawings: Number(process.env.MAX_DRAWINGS || 1000),
      maxStorageBytes: Number(process.env.MAX_DRAWING_STORAGE_MB || 256) * 1024 * 1024,
      turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
      turnstileSecret: process.env.TURNSTILE_SECRET_KEY || '',
    },
    drawingsTrustedProxies: (process.env.DRAWINGS_TRUSTED_PROXIES || '').split(',').map(s => s.trim()).filter(Boolean),
  });
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, '0.0.0.0', () => console.log(`chicomint: http://localhost:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
