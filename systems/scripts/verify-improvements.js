import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { connectDatabase } from '../draw/database.js';
import { createDrawingStorage } from '../draw/storage.js';
import { migrate } from '../draw/migration.js';
import { createPresenceServer } from '../server.js';

const store = await connectDatabase('mongodb://127.0.0.1:27017/browser_test_' + randomBytes(8).toString('hex'));
const app = createPresenceServer({ drawingStorage: createDrawingStorage(store), statsCsvPath: null, drawingsDirectory: '/tmp/chiko-browser-test-drawings' });
let browser;
const checks = [], errors = [], externalFailures = [];
function check(value, name) { assert.ok(value, name); checks.push(name); }
async function setupPage(page) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // Isolate existing third-party buttons and styles from feature verification.
  await page.route('https://**/*', route => { externalFailures.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/plain', body: '' }); });
}
try {
  await migrate(store);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const page = await context.newPage(); await setupPage(page);
  await mkdir('systems/artifacts/improvements', { recursive: true });
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
  check(await page.locator('#discord-status, script[src*="discord-status"]').count() === 0, 'Homepage has no Discord status widget or script');
  await page.waitForFunction(() => document.querySelector('[data-presence-stat=online]').textContent.trim() !== '—');
  check(await page.locator('[data-presence-stat=visits], [data-presence-stat=online]').count() === 2, 'Homepage keeps Visits and On-site displays');
  const visitorContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const visitor = await visitorContext.newPage(); await setupPage(visitor); await visitor.goto(origin + '/');
  await page.waitForFunction(() => document.querySelector('[data-presence-stat=online]').textContent.trim() === '2');
  await visitor.mouse.move(150, 150);
  await page.waitForFunction(() => document.querySelectorAll('.remote-cursor').length > 0);
  check(true, 'Other visitor cursors and live counts remain functional');
  check(await page.locator('.remote-cursor img').first().evaluate(el => el.src.endsWith('/media/miku-miku-oo-ee-oo/Normal_32.gif') && el.width === 32 && getComputedStyle(el).width === '32px'), 'Other visitors keep the original 32px Miku cursor');
  await visitorContext.close();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.mouse.move(100, 100); await page.waitForTimeout(100);
  check(await page.locator('#miku-cursor').count() === 0 && await page.locator('body').evaluate(el => getComputedStyle(el).cursor === 'auto'), 'Local mouse uses the native browser cursor');
  await page.screenshot({ path: 'systems/artifacts/improvements/home-desktop.png', fullPage: true });
  await page.goto(origin + '/blogs');
  check(await page.locator('user').count() === 1, 'Legacy blog shows the original latest post');
  await page.getByRole('link', { name: '|Click here to see all post.|', exact: true }).click();
  await page.waitForURL(origin + '/all_blog');
  check(await page.locator('user').count() === 35, 'Legacy archive contains all 35 original posts');
  check(await page.locator('.comment-form, .blog-list, script[src*=comments]').count() === 0, 'Legacy blogs have no comment or editing widgets');
  for (const path of ['/:3', '/admin', '/admin/drawings', '/admin/uploads', '/api/admin/uploads', '/admin.js', '/cms.css']) {
    check((await fetch(origin + path)).status === 404, 'Removed endpoint returns 404: ' + path);
  }
  await page.screenshot({ path: 'systems/artifacts/improvements/blogs-desktop.png', fullPage: true });
  await page.goto(origin + '/drawings'); await page.evaluate(() => window.ChikoDrawingBoard.ready);
  const pixel = (x, y) => page.evaluate(([x, y]) => Array.from(window.ChikoDrawingBoard.exportCanvas().getContext('2d').getImageData(x, y, 1, 1).data), [x, y]);
  async function dot(x, y, color) {
    if (color) await page.locator('#drawing-color').evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input')); }, color);
    const rect = await page.locator('#drawing-canvas').boundingBox();
    await page.mouse.click(rect.x + 1 + x * (rect.width - 2) / 640, rect.y + 1 + y * (rect.height - 2) / 480);
  }
  await page.locator('#drawing-size').evaluate(el => { el.value = 24; el.dispatchEvent(new Event('input')); });
  await dot(100, 100, '#ff0000'); check((await pixel(100, 100))[0] === 255, 'Brush draws on active layer');
  await page.mouse.move(400, 100); await page.getByRole('button', { name: 'Add', exact: true }).click();
  await dot(100, 100, '#0000ff'); check((await pixel(100, 100))[2] === 255, 'New layer overlays previous artwork');
  await page.getByRole('button', { name: 'Eraser', exact: true }).click(); await dot(100, 100);
  check((await pixel(100, 100))[0] === 255, 'Erasing top layer exposes intact lower layer');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); check((await pixel(100, 100))[2] === 255, 'Undo restores erased layer');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); check((await pixel(100, 100))[0] === 255, 'Redo reapplies selected-layer erase');
  await dot(100, 100, '#0000ff');
  await page.locator('#drawing-layer-name').fill('Blue layer'); await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Show Blue layer' }).uncheck(); check((await pixel(100, 100))[0] === 255, 'Layer visibility affects combined export');
  await page.getByRole('checkbox', { name: 'Show Blue layer' }).check();
  await page.locator('#drawing-layer-down').click(); check((await pixel(100, 100))[0] === 255, 'Layer reordering changes compositing');
  await page.locator('#drawing-layer-up').click();

  check(await page.locator('#drawing-circle, #drawing-smoothing').count() === 0, 'Circle and Smooth remain removed');
  check((await fetch(origin + '/b', { redirect: 'manual' })).headers.get('location') === '/drawings?restored=1', 'Retired /b URL leads to the restored drawing page');
  check(await page.locator('#drawing-gallery figure').count() === 8, 'Existing visitor gallery is restored');
  check(await page.locator('#drawing-gallery figcaption').evaluateAll(elements => elements.every(el => el.querySelectorAll('time').length === 1 && el.children.length === 1)), 'Gallery captions contain only dates');
  const fullImage = await page.locator('#drawing-gallery a').first().getAttribute('href');
  check((await fetch(origin + fullImage)).ok, 'Visitor images link to full size');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Clear All', exact: true }).click();
  check((await pixel(100, 100))[2] === 255 && await page.locator('.drawing-layer').count() === 2, 'Cancelled Clear All preserves artwork and layers');
  await page.getByRole('checkbox', { name: 'Show Layer 1' }).uncheck();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Clear All', exact: true }).click();
  check((await pixel(100, 100))[3] === 0, 'Confirmed Clear All immediately clears visible artwork');
  await page.getByRole('checkbox', { name: 'Show Layer 1' }).check();
  check((await pixel(100, 100))[3] === 0, 'Clear All also erases hidden layers');
  check(await page.locator('.drawing-layer').count() === 2, 'Clear All preserves the layer structure');
  await page.evaluate(() => window.ChikoDrawingBoard.persist()); await page.reload(); await page.evaluate(() => window.ChikoDrawingBoard.ready);
  check((await pixel(100, 100))[3] === 0, 'Cleared draft stays empty after reload');
  await dot(100, 100, '#ff0000');
  await page.getByRole('button', { name: 'Layer 1', exact: true }).click(); await dot(100, 100, '#0000ff');
  await page.getByRole('button', { name: 'Blue layer', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Clear All', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); check((await pixel(100, 100))[0] === 255, 'Undo restores every cleared layer');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); check((await pixel(100, 100))[3] === 0, 'Redo clears every layer again');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Show Blue layer' }).uncheck(); check((await pixel(100, 100))[2] === 255, 'Restored lower layer remains separate');
  await page.getByRole('checkbox', { name: 'Show Blue layer' }).check();
  await page.evaluate(() => window.ChikoDrawingBoard.persist()); await page.reload(); await page.evaluate(() => window.ChikoDrawingBoard.ready);
  check(await page.locator('.drawing-layer').count() === 2 && (await pixel(100, 100))[0] === 255, 'Separate transparent layers survive reload');
  await page.getByRole('button', { name: 'Send drawing', exact: true }).click(); await page.waitForFunction(() => document.querySelector('#drawing-status').textContent === 'Drawing sent!');
  const savedDrawing = await store.db.collection('drawings').findOne({ title: 'Visitor drawing' }, { sort: { createdAt: -1 } });
  const imageUrl = savedDrawing.image;
  const png = PNG.sync.read(Buffer.from(await (await fetch(origin + imageUrl)).arrayBuffer()));
  check(png.data[3] === 0, 'Saved PNG retains transparency');
  check(png.data[(100 * 640 + 100) * 4] === 255, 'Submitted drawing combines visible layers');
  check(await store.db.collection('drawings').countDocuments() === 9, 'Existing drawings are preserved after submission');
  check(await page.locator('#drawing-gallery figure').count() === 9, 'Submission immediately appears in the restored gallery');
  await page.reload(); await page.evaluate(() => window.ChikoDrawingBoard.ready);
  check(await page.locator('#drawing-gallery figure').count() === 9, 'Submitted visitor drawing persists in gallery after refresh');
  await page.screenshot({ path: 'systems/artifacts/improvements/drawing-desktop.png', fullPage: true });
  await page.locator('#drawing-layer-delete').click(); check(await page.locator('.drawing-layer').count() === 1, 'Layer deletion works');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Clear All', exact: true }).click();
  await page.locator('#drawing-size').evaluate(el => { el.value = 40; el.dispatchEvent(new Event('input')); });
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const cdp = await context.newCDPSession(page);
  const penRect = await page.locator('#drawing-canvas').boundingBox();
  async function penDot(x, force) {
    const clientX = penRect.x + 1 + x * (penRect.width - 2) / 640, clientY = penRect.y + 1 + 100 * (penRect.height - 2) / 480;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: clientX, y: clientY, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: clientX, y: clientY, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 });
  }
  await penDot(400, .2); await penDot(500, 1);
  check((await pixel(410, 100))[3] === 0 && (await pixel(510, 100))[3] > 0, 'Tablet pressure adjusts brush width');
  await page.locator('#drawing-size').evaluate(el => { el.value = 4; el.dispatchEvent(new Event('input')); });
  const strokeRect = await page.locator('#drawing-canvas').boundingBox();
  await page.mouse.move(strokeRect.x + 51, strokeRect.y + 51); await page.mouse.down();
  await page.mouse.move(strokeRect.x + 351, strokeRect.y + 151, { steps: 3 }); await page.mouse.up();
  check(await page.evaluate(() => {
    const image = window.ChikoDrawingBoard.exportCanvas(), ctx = image.getContext('2d');
    for (let x = 80; x < 310; x += 10) { let marked = false; const data = ctx.getImageData(x, 20, 1, 180).data; for (let i = 3; i < data.length; i += 4) marked ||= data[i] > 0; if (!marked) return false; }
    return true;
  }), 'Sparse pointer movement produces a continuous brush stroke');
  await cdp.detach();
  check((await fetch(origin + '/d/', { redirect: 'manual' })).status === 404, 'Deleted fullscreen page returns 404 without crashing the site');
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
  const phone = await mobile.newPage(); await setupPage(phone);
  for (const [path, name] of [['/', 'home-mobile'], ['/blogs', 'blogs-mobile'], ['/all_blog', 'archive-mobile'], ['/drawings', 'drawing-mobile']]) {
    await phone.goto(origin + path, { waitUntil: 'domcontentloaded' });
    if (path === '/drawings') await phone.evaluate(() => window.ChikoDrawingBoard.ready);
    check(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' has no horizontal overflow');
    await phone.screenshot({ path: 'systems/artifacts/improvements/' + name + '.png', fullPage: true });
  }
  await phone.goto(origin + '/drawings'); await phone.evaluate(() => window.ChikoDrawingBoard.ready);
  const phoneRect = await phone.locator('#drawing-canvas').boundingBox(); await phone.touchscreen.tap(phoneRect.x + 50, phoneRect.y + 50);
  check(await phone.evaluate(() => window.ChikoDrawingBoard.exportCanvas().getContext('2d').getImageData(0, 0, 640, 480).data.some((v, i) => i % 4 === 3 && v)), 'Touch input draws without decorative cursor');
  phone.once('dialog', dialog => dialog.accept()); await phone.getByRole('button', { name: 'Clear All', exact: true }).click();
  check(await phone.evaluate(() => !window.ChikoDrawingBoard.exportCanvas().getContext('2d').getImageData(0, 0, 640, 480).data.some((v, i) => i % 4 === 3 && v)), 'Clear All works on touchscreens');
  check(await phone.locator('#miku-cursor').count() === 0, 'Mobile keeps normal touch interactions');
  check(errors.length === 0, 'No introduced browser errors: ' + errors.join('; '));
  const report = { passed: true, checks, consoleErrors: errors, isolatedThirdPartyResources: [...new Set(externalFailures)] };
  await writeFile('systems/artifacts/improvements/report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: true, checks: checks.length, consoleErrors: errors }));
} finally { await browser?.close(); await app.close(); await store.db.dropDatabase(); await store.close(); }
