import { mkdir, readdir, writeFile, link, unlink, open, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes, createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { Worker } from 'node:worker_threads';
import { inflateSync } from 'node:zlib';
import { PNG } from 'pngjs';

export const MAX_DRAWING_BYTES = 2 * 1024 * 1024;
export const DRAWING_WIDTH = 640;
export const DRAWING_HEIGHT = 480;
const FILE_NAME = /^\d{13}-[a-f0-9]{32}\.png$/;
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const problem = (status, message) => Object.assign(new Error(message), { status });

export function sanitizeDrawing(buffer) {
  if (buffer.length > MAX_DRAWING_BYTES) throw problem(413, 'Drawing is too large (maximum 2 MiB).');
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(SIGNATURE) ||
      buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw problem(400, 'Please send a valid PNG drawing.');
  }
  // Check dimensions before decoding, preventing oversized decoded images.
  if (buffer.readUInt32BE(16) !== DRAWING_WIDTH || buffer.readUInt32BE(20) !== DRAWING_HEIGHT ||
      buffer[24] !== 8 || ![2, 6].includes(buffer[25]) || buffer[28] !== 0) {
    throw problem(400, 'Drawing must be a 640 × 480, non-interlaced, 8-bit RGB or RGBA PNG.');
  }
  let offset = 8;
  let headers = 0;
  let ended = false;
  const compressed = [];
  let idatEnded = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (offset + length + 12 > buffer.length || type === 'acTL') throw problem(400, 'Invalid PNG drawing.');
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== buffer.readUInt32BE(offset + 8 + length)) throw problem(400, 'Invalid PNG drawing.');
    if (type === 'IDAT') {
      if (idatEnded) throw problem(400, 'Invalid PNG drawing.');
      compressed.push(buffer.subarray(offset + 8, offset + 8 + length));
    } else if (compressed.length) idatEnded = true;
    if (type === 'IHDR' && ++headers !== 1) throw problem(400, 'Invalid PNG drawing.');
    offset += length + 12;
    if (type === 'IEND') { ended = length === 0 && offset === buffer.length; break; }
  }
  if (!ended) throw problem(400, 'Incomplete PNG drawing.');
  let image;
  try {
    // pngjs truncates excessive inflated data; independently require the exact raster size.
    const expected = (DRAWING_WIDTH * (buffer[25] === 6 ? 4 : 3) + 1) * DRAWING_HEIGHT;
    const decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
    if (decoded.length !== expected) throw new Error('Invalid raster');
    image = PNG.sync.read(buffer, { checkCRC: true }); }
  catch { throw problem(400, 'Invalid PNG drawing.'); }
  let marked = false;
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3] / 255;
    for (let channel = 0; channel < 3; channel++) {
      const value = Math.round(image.data[i + channel] * alpha + 255 * (1 - alpha));
      image.data[i + channel] = value;
      if (value !== 255) marked = true;
    }
    image.data[i + 3] = 255;
  }
  if (!marked) throw problem(400, 'Draw something before sending.');
  // Encode only decoded pixels: no client metadata, appended files, or transparency.
  return PNG.sync.write({ width: DRAWING_WIDTH, height: DRAWING_HEIGHT, data: image.data }, { colorType: 2 });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const timeout = setTimeout(() => finish(problem(408, 'Upload timed out.')), 15000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      req.off('data', data);
      req.off('end', end);
      req.off('aborted', aborted);
      req.off('error', failed);
      if (error) { req.resume(); reject(error); }
      else resolve(Buffer.concat(chunks, size));
    }
    function data(chunk) {
      size += chunk.length;
      if (size > MAX_DRAWING_BYTES) finish(problem(413, 'Drawing is too large (maximum 2 MiB).'));
      else chunks.push(chunk);
    }
    const end = () => finish();
    const aborted = () => finish(problem(400, 'Upload interrupted.'));
    const failed = () => finish(problem(400, 'Unable to read upload.'));
    req.on('data', data).on('end', end).on('aborted', aborted).on('error', failed);
  });
}

// Bound CPU time and keep PNG work off the presence/WebSocket event loop.
function sanitizeAsync(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./drawings-worker.js', import.meta.url), { workerData: buffer,
      resourceLimits: { maxOldGenerationSizeMb: 48 } });
    const timeout = setTimeout(() => { void worker.terminate(); reject(problem(400, 'Invalid drawing.')); }, 5000);
    worker.once('message', result => {
      clearTimeout(timeout);
      if (result.error) reject(problem(result.status || 400, result.error));
      else resolve(Buffer.from(result.png));
    });
    worker.once('error', () => { clearTimeout(timeout); reject(problem(400, 'Invalid drawing.')); });
    worker.once('exit', code => { clearTimeout(timeout); if (code) reject(problem(400, 'Invalid drawing.')); });
  });
}

export function createDrawingsApi({ directory, allowedOrigins = [], trustedProxies = [],
  maxDrawings = 1000, maxStorageBytes = 256 * 1024 * 1024,
  turnstileSiteKey = '', turnstileSecret = '', verifyFetch = fetch, now = Date.now } = {}) {
  if (![maxDrawings, maxStorageBytes].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid drawing storage limits');
  if (Boolean(turnstileSiteKey) !== Boolean(turnstileSecret)) throw new Error('Both Turnstile keys are required');
  directory = resolve(directory);
  const limits = new Map();
  const salt = randomBytes(32);
  let uploading = 0;
  let writeQueue = Promise.resolve();
  let logWindow = 0, logCount = 0;
  const globalAttempts = [];
  const ready = mkdir(directory, { recursive: true }).then(async () => {
    if ((await realpath(directory)) !== directory || !(await lstat(directory)).isDirectory()) throw new Error('Unsafe drawings directory');
  });
  ready.catch(() => {});
  async function checkDirectory() {
    await ready;
    if ((await lstat(directory)).isSymbolicLink() || await realpath(directory) !== directory) throw new Error('Unsafe drawings directory');
  }
  const metadata = filename => ({ filename, url: `/drawings/${filename}`,
    createdAt: new Date(Number(filename.slice(0, 13))).toISOString() });
  function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(value));
  }
  function clientAddress(req) {
    let address = req.socket.remoteAddress || 'unknown';
    // Only exact, operator-verified proxy peers may supply X-Real-IP. Railway documents
    // this header; never trust X-Forwarded-For or infer trust from a request header.
    // With no verified peers, fall back to shared peer limits (safe, but less granular).
    const forwarded = req.headers['x-real-ip'];
    if (trustedProxies.includes(address) && typeof forwarded === 'string' && isIP(forwarded)) address = forwarded;
    if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) address = address.slice(7);
    if (isIP(address) === 6) {
      // Canonicalize then group IPv6 by /64, preventing rotation within a client subnet.
      const host = new URL(`http://[${address}]/`).hostname.slice(1, -1);
      const halves = host.split('::');
      const left = halves[0] ? halves[0].split(':') : [];
      const right = halves[1] ? halves[1].split(':') : [];
      address = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right].slice(0, 4).join(':');
    }
    return address;
  }
  function limit(req) {
    const time = now();
    for (const [key, entry] of limits) if (entry.at(-1) <= time - 86400000) limits.delete(key);
    const key = createHmac('sha256', salt).update(clientAddress(req)).digest('hex');
    let entry = (limits.get(key) || []).filter(at => at > time - 86400000);
    if (!limits.has(key) && limits.size >= 10000) throw problem(429, 'You\'re sending drawings too quickly. Try again later.');
    const windows = [[10000, 2], [600000, 5], [86400000, 20]];
    for (const [duration, maximum] of windows) {
      if (entry.filter(at => at > time - duration).length >= maximum) {
        throw problem(429, "You're sending drawings too quickly. Try again later.");
      }
    }
    while (globalAttempts.length && globalAttempts[0] <= time - 60000) globalAttempts.shift();
    if (globalAttempts.length >= 30) throw problem(429, "You're sending drawings too quickly. Try again later.");
    entry.push(time); limits.set(key, entry); globalAttempts.push(time);
  }
  async function challenge(req) {
    if (!turnstileSecret) return;
    const token = req.headers['x-turnstile-token'];
    if (typeof token !== 'string' || !token.length || token.length > 2048) throw problem(403, 'Please complete the drawing challenge.');
    try {
      const response = await verifyFetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', body: new URLSearchParams({ secret: turnstileSecret, response: token }),
        signal: AbortSignal.timeout(5000),
      });
      const result = await response.json();
      if (!response.ok || !result.success || result.action !== 'drawing' || result.hostname !== new URL(req.headers.origin).hostname) throw new Error();
    } catch { throw problem(403, 'Please complete the drawing challenge again.'); }
  }
  async function save(buffer) {
    const operation = writeQueue.then(async () => {
      await checkDirectory();
      let count = 0, bytes = 0;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const stat = await lstat(join(directory, entry.name));
        if (!stat.isFile()) continue;
        bytes += stat.size; // Count unrelated/leftover files too, but never delete them.
        if (FILE_NAME.test(entry.name)) count++;
      }
      if (count >= maxDrawings || bytes + buffer.length > maxStorageBytes) throw problem(507, 'Drawing storage is full. Please try again later.');
      const filename = `${Date.now()}-${randomBytes(16).toString('hex')}.png`;
      const temporary = join(directory, '.' + filename + '.tmp');
      let created = false;
      try {
        await writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
        created = true;
        // Hard-link publication is atomic AND refuses to overwrite a destination.
        await link(temporary, join(directory, filename));
      } finally { if (created) await unlink(temporary); }
      return filename;
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }
  return async function drawingsRoute(req, res, path) {
    // An aborted body may emit an error after its read promise has settled.
    req.on('error', () => {});
    let uploadStarted = false;
    try {
      if (path.startsWith('/drawings/')) {
        if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); throw problem(405, 'Method not allowed.'); }
        const filename = path.slice('/drawings/'.length);
        if (!FILE_NAME.test(filename)) throw problem(404, 'Drawing not found.');
        await checkDirectory();
        let file;
        try { file = await open(join(directory, filename), constants.O_RDONLY | constants.O_NOFOLLOW); }
        catch (error) {
          if (['ENOENT', 'ELOOP'].includes(error.code)) throw problem(404, 'Drawing not found.');
          throw error;
        }
        try {
          const stat = await file.stat();
          if (!stat.isFile()) throw problem(404, 'Drawing not found.');
          res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': stat.size,
            'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
          if (req.method === 'HEAD') { await file.close(); res.end(); return; }
          const stream = file.createReadStream();
          stream.on('error', () => res.destroy());
          res.on('close', () => stream.destroy());
          stream.pipe(res);
        } catch (error) { await file.close(); throw error; }
        return;
      }
      if (path === '/api/drawings/config') {
        if (req.method !== 'GET') throw problem(405, 'Method not allowed.');
        json(res, 200, { turnstileSiteKey }); return;
      }
      if (req.method === 'GET') {
        await checkDirectory();
        const files = await readdir(directory, { withFileTypes: true });
        const drawings = files.filter(file => file.isFile() && FILE_NAME.test(file.name))
          .map(file => metadata(file.name)).sort((a, b) => b.filename.localeCompare(a.filename));
        json(res, 200, drawings);
        return;
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); throw problem(405, 'Method not allowed.'); }
      limit(req);
      {
        let valid = false;
        try {
          const origin = new URL(req.headers.origin);
          valid = allowedOrigins.length ? allowedOrigins.includes(origin.origin) :
            origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) && origin.host === req.headers.host;
        } catch {}
        if (!valid) throw problem(403, 'Drawing submissions must come from this website.');
      }
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'image/png' ||
          (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) {
        throw problem(400, 'Only PNG drawings are accepted.');
      }
      if (Number(req.headers['content-length']) > MAX_DRAWING_BYTES) throw problem(413, 'Drawing is too large (maximum 2 MiB).');
      if (uploading >= 4) throw problem(503, 'Drawing board is busy. Try again shortly.');
      uploading++;
      uploadStarted = true;
      // Read with a hard limit before challenge verification; never accumulate unbounded bodies.
      const body = await readBody(req);
      await challenge(req);
      const buffer = await sanitizeAsync(body);
      const filename = await save(buffer);
      res.setHeader('Location', `/drawings/${filename}`);
      json(res, 201, metadata(filename));
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      const status = error.code === 'ENOSPC' ? 507 : error.status || 500;
      if (now() - logWindow >= 60000) { logWindow = now(); logCount = 0; }
      if (logCount++ < 10) console.warn(JSON.stringify({ timestamp: new Date().toISOString(),
        event: 'drawing_rejected', status, reason: error.status ? error.message : 'storage_or_internal_failure',
        requestId: randomBytes(8).toString('hex') }));
      if (status === 429) res.setHeader('Retry-After', '600');
      if (req.method === 'POST') { res.setHeader('Connection', 'close'); req.resume(); }
      json(res, status, { error: status === 507 ? 'Drawing storage is full. Please try again later.' : error.status ? error.message : 'Unable to access the drawing gallery. Please try again.' });
    } finally { if (uploadStarted) uploading--; }
  };
}
