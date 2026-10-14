import { createCursorServer } from './cursor/server.js';
import { canonicalPath, cleanHtml } from './site/urls.js';
import { connectDatabase } from './draw/database.js';
import { createDrawingStorage } from './draw/storage.js';
import { migrate } from './draw/migration.js';
import { layout, drawingsPage } from './site/pages.js';
import { handleError } from './site/http.js';
import { createServer } from 'node:http';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDrawingsApi } from './draw/api.js';
import { visitorStats } from './visit/stats.js';
import { clientIpResolver } from './visit/client-ip.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SYSTEMS = fileURLToPath(new URL('.', import.meta.url));
const STATS_CSV = join(SYSTEMS, 'visit/stats.csv');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.cur': 'image/x-icon',
  '.ani': 'application/octet-stream', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
  '.txt': 'text/plain', '.xml': 'application/xml', '.woff2': 'font/woff2' };

// Explicitly publish website files, never the whole project directory.
function publicFiles() {
  const files = new Map();
  const scan = (folder, publicFolder = folder) => {
    let entries;
    try { entries = readdirSync(join(ROOT, folder), { withFileTypes: true }); }
    catch (error) {
      // Public asset folders are optional; deleted pages must not stop startup.
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relative = join(folder, entry.name);
      const publicPath = join(publicFolder, entry.name);
      if (entry.isDirectory()) scan(relative, publicPath);
      else if (entry.isFile() && TYPES[extname(entry.name)]) files.set('/' + publicPath, join(ROOT, relative));
    }
  };
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && !entry.name.startsWith('.') && /\.html$/.test(entry.name)) files.set('/' + entry.name, join(ROOT, entry.name));
  }
  const assets = {
    '/cursor/client.js': 'cursor/client.js', '/draw/board.js': 'draw/board.js',
    '/draw/gallery.js': 'draw/gallery.js',
  };
  for (const [url, path] of Object.entries(assets)) files.set(url, join(SYSTEMS, path));
  for (const name of ['style.css', 'sakura.css', 'sakura-dark.css', 'cursor.css', 'visitor-stats.css', 'drawing-fullscreen.css', 'sitemap.xml', 'robots.txt']) {
    files.set('/' + name, join(ROOT, name));
  }
  const aliases = {
    '/realtime.js': '/cursor/client.js', '/cursor/style.css': '/cursor.css',
    '/drawing-board.js': '/draw/board.js', '/drawings.js': '/draw/gallery.js',
    '/draw/fullscreen.css': '/drawing-fullscreen.css', '/site/style.css': '/style.css',
    '/site/sakura.css': '/sakura.css', '/site/sakura-dark.css': '/sakura-dark.css',
    '/visit/style.css': '/visitor-stats.css',
  };
  for (const [url, target] of Object.entries(aliases)) files.set(url, files.get(target));
  for (const folder of ['media', 'picture', 'd', 'math']) scan(folder);
  scan('media/blog-images', 'blog-images');
  return files;
}

export function createPresenceServer({
  allowedOrigins = [], heartbeatMs = 15000, statsCsvPath = STATS_CSV,
  drawingsDirectory = join(SYSTEMS, 'data/drawings'), drawingsTrustedProxies = [], drawingsOptions = {},
  statsTrustedProxies = [], statsIpHeader = 'x-forwarded-for', statsOptions = {}, drawingStorage = null } = {}) {
  const clientIp = clientIpResolver({ trustedProxies: statsTrustedProxies, header: statsIpHeader });
  const visits = visitorStats(statsCsvPath, statsOptions);
  const files = publicFiles();
  const drawingsRoute = createDrawingsApi({ directory: drawingsDirectory, allowedOrigins, trustedProxies: drawingsTrustedProxies, storage: drawingStorage, ...drawingsOptions });
  const pageName = path => {
    path = canonicalPath(path);
    if (path.endsWith('/')) return path + 'index.html';
    return files.has(path + '.html') ? path + '.html' : path;
  };
  const publicPage = path => files.has(pageName(path)) && pageName(path).endsWith('.html');
  const server = createServer(async (req, res) => {
    try {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    let path, url;
    try { url = new URL(req.url, 'http://localhost'); path = decodeURIComponent(url.pathname); }
    catch { res.writeHead(400).end(); return; }
    if (path === '/health') {
      if (drawingStorage) { try { await drawingStorage.health(); } catch { res.writeHead(503).end('unavailable'); return; } }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('ok');
      return;
    }
    // Retire the old board URL. The query bypasses its cached inverse redirect.
    if (path === '/b') { res.writeHead(302, { Location: '/drawings?restored=1', 'Cache-Control': 'no-store' }); res.end(); return; }
    const canonical = canonicalPath(path);
    if (canonical !== path) { res.writeHead(301, { Location: canonical + url.search }); res.end(); return; }
    if (path.length > 1 && path.endsWith('/') && !['/d/', '/math/'].includes(path)) { res.writeHead(301, { Location: path.slice(0, -1) + url.search }); res.end(); return; }
    if (['/d', '/math'].includes(path)) { res.writeHead(301, { Location: path + '/' + url.search }); res.end(); return; }
    if (req.headers.host === 'www.chiko.cc') { res.writeHead(301, { Location: 'https://chiko.cc' + path + url.search }); res.end(); return; }
    if (drawingStorage && (path === '/drawings' || path.startsWith('/uploads/'))) {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
      if (path.startsWith('/uploads/')) { await drawingStorage.serveImage(req, res, path.slice('/uploads/'.length)); return; }
      if (visits.record(clientIp(req), req.method === 'GET')) cursors.broadcastStats();
      const html = req.method === 'HEAD' ? undefined : drawingsPage(await drawingStorage.list());
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    if (path === '/api/drawings' || path === '/api/drawings/config' || path.startsWith('/drawings/')) {
      if (req.method === 'GET' || req.method === 'HEAD') visits.record(null, false);
      void drawingsRoute(req, res, path);
      return;
    }
    const file = files.get(pageName(path));
    if (!file) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(layout('Not found', '<h2>Page not found</h2><a href="/">Back home</a>')); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const newVisit = visits.record(clientIp(req), req.method === 'GET' && extname(file) === '.html');
    if (newVisit) cursors.broadcastStats();
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') { res.end(); return; }
    if (path === '/') {
      const totals = { online: cursors.onlineCount() };
      const visitTotal = visits.counts().visits;
      if (visitTotal !== null) totals.visits = visitTotal;
      let html = readFileSync(file, 'utf8');
      for (const [name, value] of Object.entries(totals)) {
        html = html.replace(new RegExp(`(data-presence-stat="${name}"[^>]*>)[^<]*`),
          (_, opening) => opening + value.toLocaleString('en-US'));
      }
      res.end(cleanHtml(html));
      return;
    }
    if (extname(file) === '.html') { res.end(cleanHtml(readFileSync(file, 'utf8'), path)); return; }
    const stream = createReadStream(file);
    stream.on('error', () => { if (!res.headersSent) res.writeHead(404); res.end(); });
    stream.pipe(res);
    } catch (error) { handleError(req, res, error, layout); }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  const cursors = createCursorServer({ server, allowedOrigins, heartbeatMs, counts: visits.counts, publicPage });
  return { server, wss: cursors.wss, async close() {
    await cursors.close();
    await new Promise(done => server.close(done));
    await visits.close();
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.chdir(ROOT);
  if (process.env.RAILWAY_ENVIRONMENT_ID && !process.env.STATS_TRUSTED_PROXIES) {
    console.warn('Visit statistics: configure STATS_TRUSTED_PROXIES and STATS_IP_HEADER for the verified Railway proxy; otherwise visits use the socket IP.');
  }
  const dataDirectory = process.env.DATA_DIRECTORY || '';
  const statsCsvPath = process.env.STATS_CSV_PATH || (dataDirectory ? join(dataDirectory, 'chicomint-stats.csv') : STATS_CSV);
  if (!existsSync(statsCsvPath)) {
    mkdirSync(dirname(statsCsvPath), { recursive: true });
    copyFileSync(existsSync(join(ROOT, 'legacy/visitor-stats.csv')) ? join(ROOT, 'legacy/visitor-stats.csv') : STATS_CSV, statsCsvPath);
  }
  let store, drawingStorage;
  try {
    if (process.env.MONGODB_URI) {
      store = await connectDatabase();
      drawingStorage = createDrawingStorage(store, { maxDrawings: Number(process.env.MAX_DRAWINGS || 1000) });
      const verified = await store.db.collection('migrations').findOne({ _id: 'legacy-drawings-v1' }) || await store.db.collection('migrations').findOne({ _id: 'legacy-v1' });
      if (Number.isSafeInteger(verified?.drawings) && verified.drawings >= 0 && verified.verifiedAt) {
        const drawings = await store.db.collection('drawings').countDocuments({ legacyKey: { $exists: true } });
        if (drawings < verified.drawings) throw new Error('Verified drawing data is incomplete.');
        console.log(JSON.stringify({ event: 'migration_already_verified', drawings }));
      } else if (process.env.NODE_ENV === 'production') {
        throw new Error('Production migration requires explicit verification.');
      } else {
        const result = await migrate(store);
        console.log(JSON.stringify({ event: 'migration_verified', ...result }));
      }
    } else if (process.env.NODE_ENV === 'production') throw new Error('Drawing database configuration required');
  } catch {
    console.error('Drawing storage startup failed. Check server configuration, database access and migration sources.');
    await store?.close();
    process.exit(1);
  }
  const app = createPresenceServer({
    drawingStorage,
    statsCsvPath,
    statsTrustedProxies: (process.env.STATS_TRUSTED_PROXIES || '').split(',').map(s => s.trim()).filter(Boolean),
    statsIpHeader: process.env.STATS_IP_HEADER || 'x-forwarded-for',
    allowedOrigins: (process.env.SITE_ORIGIN || process.env.ALLOWED_ORIGINS || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')).split(',').map(s => s.trim()).filter(Boolean),
    drawingsDirectory: process.env.DRAWINGS_DIRECTORY || (dataDirectory ? join(dataDirectory, 'drawings') : join(SYSTEMS, 'data/drawings')),
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
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); await store?.close(); process.exit(0); });
}
