import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { PNG } from 'pngjs';
import { createPresenceServer } from '../server.js';
import { sanitizeDrawing, MAX_DRAWING_BYTES } from '../drawings-api.js';

function png({ marked = true, transparent = false, width = 640 } = {}) {
  const image = new PNG({ width, height: 480 });
  image.data.fill(transparent ? 0 : 255);
  if (marked) {
    const pixel = (100 * width + 100) * 4;
    image.data[pixel] = 0;
    image.data[pixel + 1] = 100;
    image.data[pixel + 2] = 200;
    image.data[pixel + 3] = 255;
  }
  return PNG.sync.write(image);
}

async function fixture(t, drawingsOptions = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'chicomint-drawings-'));
  const directory = join(folder, 'images');
  let app;
  async function start() {
    app = createPresenceServer({ statsCsvPath: null, drawingsDirectory: directory, drawingsOptions });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    return `http://127.0.0.1:${app.server.address().port}`;
  }
  const base = await start();
  t.after(async () => { await app.close(); await rm(folder, { recursive: true, force: true }); });
  return { base, directory, restart: async () => { await app.close(); return start(); },
    post: (body, headers = {}) => fetch(base + '/api/drawings', { method: 'POST', body,
      headers: { 'Content-Type': 'image/png', Origin: base, ...headers } }),
  };
}

test('PNG validation rejects blank, transparent, corrupt, oversized, and wrong-size drawings', () => {
  for (const buffer of [png({ marked: false }), png({ marked: false, transparent: true })]) {
    assert.throws(() => sanitizeDrawing(buffer), error => error.status === 400);
  }
  assert.throws(() => sanitizeDrawing(Buffer.alloc(MAX_DRAWING_BYTES + 1)), error => error.status === 413);
  assert.throws(() => sanitizeDrawing(png({ width: 1024 })), error => error.status === 400);
  const corrupt = png();
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => sanitizeDrawing(corrupt), error => error.status === 400);
  assert.throws(() => sanitizeDrawing(Buffer.concat([png(), Buffer.from('<script>bad()</script>')])), error => error.status === 400);
  assert.throws(() => sanitizeDrawing(Buffer.from('not a PNG')), error => error.status === 400);
  const clean = PNG.sync.read(sanitizeDrawing(png({ transparent: true })));
  assert.deepEqual([...clean.data.subarray(0, 4)], [255, 255, 255, 255]);
  assert.equal(clean.width, 640);
  assert.equal(clean.height, 480);
});

test('drawings upload, serve immediately, sort newest first and survive server restart', async t => {
  const app = await fixture(t);
  assert.deepEqual(await (await fetch(app.base + '/api/drawings')).json(), []);
  const firstResponse = await app.post(png());
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  assert.match(first.filename, /^\d{13}-[a-f0-9]{32}\.png$/);
  const image = await fetch(app.base + first.url);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(PNG.sync.read(Buffer.from(await image.arrayBuffer())).width, 640);
  const second = await (await app.post(png())).json();
  assert.notEqual(first.filename, second.filename);
  const gallery = await (await fetch(app.base + '/api/drawings')).json();
  assert.equal(gallery.length, 2);
  assert.equal(gallery[0].filename, second.filename);
  const restarted = await app.restart();
  assert.deepEqual(await (await fetch(restarted + '/api/drawings')).json(), gallery);
  assert.equal((await readdir(app.directory)).length, 2);
});

test('HTTP rejects wrong formats, foreign origins, excessive bodies, and blank PNGs', async t => {
  let clock = Date.now();
  const app = await fixture(t, { now: () => clock += 11000 });
  assert.equal((await app.post(png(), { 'Content-Type': 'image/jpeg' })).status, 400);
  assert.equal((await app.post(png(), { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await app.post(Buffer.alloc(MAX_DRAWING_BYTES + 1))).status, 413);
  assert.equal((await app.post(png({ marked: false }))).status, 400);
  assert.equal((await app.post(Buffer.from('data:image/png;base64,fake'))).status, 400);
  assert.deepEqual(await (await fetch(app.base + '/api/drawings')).json(), []);
});

test('chunked uploads cannot bypass the body limit', async t => {
  const app = await fixture(t);
  const status = await new Promise((resolve, reject) => {
    const req = request(app.base + '/api/drawings', { method: 'POST', headers: { 'Content-Type': 'image/png', Origin: app.base } }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.write(Buffer.alloc(MAX_DRAWING_BYTES));
    req.end(Buffer.alloc(10));
  });
  assert.equal(status, 413);
});

test('an interrupted upload leaves no file and the server stays available', async t => {
  const app = await fixture(t);
  await new Promise(resolve => {
    const req = request(app.base + '/api/drawings', { method: 'POST', headers: { 'Content-Type': 'image/png', Origin: app.base } });
    req.on('error', () => {});
    req.on('close', resolve);
    req.write(png().subarray(0, 100));
    setTimeout(() => req.destroy(), 30);
  });
  const response = await fetch(app.base + '/api/drawings');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});

test('storage failures return a generic error without exposing paths', async t => {
  const app = await fixture(t);
  await fetch(app.base + '/api/drawings');
  await rm(app.directory, { recursive: true });
  await writeFile(app.directory, 'not a directory');
  const response = await app.post(png());
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes(app.directory), false);
});

test('submissions are rate-limited and forwarded headers cannot spoof an untrusted peer', async t => {
  const app = await fixture(t);
  for (let i = 0; i < 2; i++) assert.equal((await app.post(Buffer.from('bad'))).status, 400);
  const response = await app.post(png(), { 'X-Real-IP': '1.2.3.4', 'X-Forwarded-For': '5.6.7.8' });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '600');
  assert.deepEqual(await (await fetch(app.base + '/api/drawings')).json(), []);
});

test('gallery ignores non-images and symlinks, and rejects traversal paths and unsupported methods', async t => {
  const app = await fixture(t);
  // Wait for automatic directory creation.
  await fetch(app.base + '/api/drawings');
  await writeFile(join(app.directory, 'secret.txt'), 'private');
  const linkName = `1726832412345-${'a'.repeat(32)}.png`;
  await symlink(join(app.directory, 'secret.txt'), join(app.directory, linkName));
  assert.deepEqual(await (await fetch(app.base + '/api/drawings')).json(), []);
  for (const path of ['/drawings/' + linkName, '/drawings/secret.txt', '/drawings/%2e%2e%2fserver.js', '/data/drawings/secret.txt']) {
    assert.equal((await fetch(app.base + path)).status, 404, path);
  }
  assert.equal((await fetch(app.base + '/api/drawings', { method: 'DELETE' })).status, 405);
});


test('storage count is enforced across concurrent requests and restart', async t => {
  const app = await fixture(t, { maxDrawings: 1 });
  const responses = await Promise.all([app.post(png()), app.post(png())]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 507]);
  const restarted = await app.restart();
  assert.equal((await fetch(restarted + '/api/drawings', { method: 'POST',
    headers: { Origin: restarted, 'Content-Type': 'image/png' }, body: png() })).status, 507);
});

test('byte capacity rejects without storing files', async t => {
  const app = await fixture(t, { maxStorageBytes: 1 });
  assert.equal((await app.post(png())).status, 507);
  assert.deepEqual(await readdir(app.directory), []);
});

test('origin is mandatory; secret and server files are never public', async t => {
  const app = await fixture(t);
  assert.equal((await fetch(app.base + '/api/drawings', { method: 'POST', body: png(), headers: { 'Content-Type': 'image/png' } })).status, 403);
  for (const path of ['/server.js', '/drawings-api.js', '/drawings-worker.js', '/.env']) {
    assert.equal((await fetch(app.base + path)).status, 404);
  }
});

test('ten-minute and daily limits remain after the burst window', async t => {
  let clock = Date.now();
  const app = await fixture(t, { now: () => clock });
  for (let i = 0; i < 20; i++) {
    if (i && i % 5 === 0) clock += 600001;
    assert.equal((await app.post(Buffer.from('bad'))).status, 400);
    clock += 11000;
    if (i === 4) assert.equal((await app.post(png())).status, 429);
  }
  clock += 600001;
  assert.equal((await app.post(png())).status, 429);
  clock += 86400001;
  assert.equal((await app.post(Buffer.from('bad'))).status, 400);
});

test('Turnstile requires token, valid action and matching hostname', async t => {
  let result = { success: true, hostname: 'evil.example', action: 'drawing' };
  let clock = Date.now();
  const app = await fixture(t, { now: () => clock += 11000, turnstileSiteKey: 'public-key', turnstileSecret: 'private-key',
    verifyFetch: async () => ({ ok: true, json: async () => result }) });
  assert.deepEqual(await (await fetch(app.base + '/api/drawings/config')).json(), { turnstileSiteKey: 'public-key' });
  assert.equal((await app.post(png())).status, 403);
  assert.equal((await app.post(png(), { 'X-Turnstile-Token': 'token' })).status, 403);
  result = { success: true, hostname: '127.0.0.1', action: 'drawing' };
  assert.equal((await app.post(png(), { 'X-Turnstile-Token': 'token' })).status, 201);
});
