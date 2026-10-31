import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { load } from 'cheerio';
import { connectDatabase } from '../draw/database.js';
import { migrate } from '../draw/migration.js';
import { createDrawingStorage, storeImage } from '../draw/storage.js';
import { createPresenceServer } from '../server.js';

test('public drawing storage preserves legacy images and submissions without admin services', { timeout: 30000 }, async () => {
  const store = await connectDatabase('mongodb://127.0.0.1:27017/drawing_storage_' + randomBytes(8).toString('hex'));
  const folder = await mkdtemp('/tmp/chiko-drawing-storage-');
  let app, origin;
  async function start() {
    app = createPresenceServer({ drawingStorage: createDrawingStorage(store, { maxDrawings: 9 }), statsCsvPath: null, drawingsDirectory: join(folder, 'drawings') });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    origin = 'http://127.0.0.1:' + app.server.address().port;
  }
  try {
    assert.equal((await migrate(store)).drawings, 8);
    await migrate(store);
    assert.equal(await store.db.collection('drawings').countDocuments(), 8);
    assert.equal((await store.db.listCollections().toArray()).some(item => ['sessions', 'loginLimits', 'blogs', 'comments'].includes(item.name)), false);
    await start();
    assert.equal((await fetch(origin + '/health')).status, 200);
    const gallery = await (await fetch(origin + '/api/drawings')).json();
    assert.equal(gallery.length, 8);
    const html = await (await fetch(origin + '/drawings')).text();
    assert.equal(load(html)('#drawing-gallery figure').length, 8);
    assert.doesNotMatch(html, /admin\.js|cms\.css|Admin dashboard|Log in|Logout/);
    const legacy = await store.db.collection('drawings').findOne({ legacyKey: { $exists: true } });
    const redirect = await fetch(origin + '/drawings/' + legacy.legacyFilename, { redirect: 'manual' });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), legacy.image);
    for (const drawing of gallery) {
      const image = await fetch(origin + drawing.image);
      assert.equal(image.status, 200);
      assert.ok((await image.arrayBuffer()).byteLength > 0);
      assert.equal((await fetch(origin + drawing.image, { method: 'HEAD' })).status, 200);
    }
    for (const path of ['/:3', '/admin', '/admin/drawings', '/admin/drawings/new', '/admin/uploads', '/admin/logout', '/api/admin/uploads', '/admin.js', '/cms.css', '/cms/auth.js']) {
      for (const method of ['GET', 'HEAD', 'POST']) assert.equal((await fetch(origin + path, { method })).status, 404, method + ' ' + path);
    }
    const png = new PNG({ width: 640, height: 480 });
    png.data.fill(255); png.data[0] = 0;
    const bytes = PNG.sync.write(png);
    const hiddenFile = await storeImage(store, { bytes, mime: 'image/png', extension: 'png' });
    assert.equal((await fetch(origin + hiddenFile.url)).status, 404, 'Unused uploads remain private');
    const response = await fetch(origin + '/api/drawings', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'image/png' }, body: bytes });
    assert.equal(response.status, 201);
    const saved = await response.json();
    assert.equal((await fetch(origin + saved.image)).status, 200);
    assert.equal((await (await fetch(origin + '/api/drawings')).json()).length, 9);
    assert.equal((await fetch(origin + '/api/drawings', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'image/png' }, body: bytes })).status, 507);
    await app.close(); app = null;
    await start();
    assert.equal((await (await fetch(origin + '/api/drawings')).json()).length, 9);
    assert.equal((await fetch(origin + saved.image)).status, 200);
    await store.db.collection('drawings').updateOne({ _id: legacy._id }, { $set: { published: false } });
    assert.equal((await fetch(origin + legacy.image)).status, 404);
    assert.equal((await (await fetch(origin + '/api/drawings')).json()).length, 8);
    assert.equal((await fetch(origin + '/uploads/not-an-id')).status, 404);
    assert.equal((await fetch(origin + saved.image, { method: 'POST' })).status, 405);
  } finally {
    await app?.close(); await store.db.dropDatabase(); await store.close(); await rm(folder, { recursive: true, force: true });
  }
});
