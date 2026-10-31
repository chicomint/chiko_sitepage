import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../..', import.meta.url));
const pages = (await readdir(root)).filter(name => name.endsWith('.html')).concat('math/index.html');
const errors = [], failedFiles = [], backendRequests = [], checks = [];
const output = join(root, 'systems/artifacts/local-html');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, colorScheme: name === 'desktop' ? 'light' : 'dark', acceptDownloads: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(page.url() + ': ' + error.stack));
    page.on('requestfailed', request => { if (request.url().startsWith('file:')) failedFiles.push(request.url() + ': ' + request.failure()?.errorText); });
    page.on('request', request => { if (/\/(?:api\/drawings|presence)(?:\?|$)/.test(request.url())) backendRequests.push(request.url()); });
    // Third-party content is independent of local file navigation and asset paths.
    await page.route('https://**/*', route => route.fulfill({ status: 200, contentType: route.request().resourceType() === 'stylesheet' ? 'text/css' : 'text/plain', body: '' }));
    for (const path of pages) {
      await page.goto(pathToFileURL(join(root, path)).href, { waitUntil: 'load' });
      const styles = await page.locator('link[rel=stylesheet]').evaluateAll(links => links.filter(link => link.href.startsWith('file:')).every(link => link.sheet !== null));
      assert.ok(styles, name + ' ' + path + ': local styles loaded');
      const failedImages = await page.locator('img').evaluateAll(async images => {
        const localImages = images.filter(image => image.getAttribute('src') && image.src.startsWith('file:'));
        await Promise.all(localImages.map(image => image.decode().catch(() => {})));
        return localImages.filter(image => !image.complete || !image.naturalWidth).map(image => image.src);
      });
      assert.deepEqual(failedImages, [], name + ' ' + path + ': local images loaded');
      if (['index.html', 'blogs.html', 'all_blog.html', 'drawings.html', 'credits.html', 'project.html'].includes(path)) {
        await page.evaluate(() => document.fonts.ready);
        assert.ok(await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Arial')), name + ' ' + path + ': reference typography applied');
        assert.ok(await page.evaluate(() => [...document.fonts].some(font => font.family.includes('DotGothic16') && font.status === 'loaded')), name + ' ' + path + ': local font loaded');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' ' + path + ': no horizontal overflow');
      }
      checks.push(name + ': ' + path);
    }
    await page.goto(pathToFileURL(join(root, 'blogs.html')).href, { waitUntil: 'load' });
    // Wait for intrinsic image sizes before scrolling to the archive link.
    await page.locator('img').evaluateAll(images => Promise.all(images.filter(image => image.src.startsWith('file:')).map(image => image.decode().catch(() => {}))));
    assert.equal(await page.locator('user').count(), 3);
    await page.screenshot({ path: join(output, 'blogs-' + name + '.png'), fullPage: true });
    const archiveLink = page.getByRole('link', { name: '|Click here to see all post.|', exact: true });
    await archiveLink.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await archiveLink.click();
    await page.waitForURL('**/all_blog.html');
    assert.equal(await page.locator('user').count(), 37);
    await page.screenshot({ path: join(output, 'archive-' + name + '.png') });
    await page.getByRole('link', { name: '← back to the blog', exact: true }).click();
    await page.waitForURL('**/blogs.html');
    for (const [label, path] of [['home', 'index.html'], ['projects', 'project.html'], ['credits', 'credits.html'], ['drawings', 'drawings.html'], ['blog', 'blogs.html']]) {
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: label, exact: true }).click();
      await page.waitForURL('**/' + path);
    }
    await page.goto(pathToFileURL(join(root, 'drawings.html')).href, { waitUntil: 'load' });
    await page.evaluate(() => window.ChikoDrawingBoard.ready);
    assert.ok(await page.locator('#drawing-send').isDisabled());
    const rect = await page.locator('#drawing-canvas').boundingBox();
    await page.mouse.move(rect.x + 30, rect.y + 30);
    await page.mouse.down(); await page.mouse.move(rect.x + 80, rect.y + 60, { steps: 4 }); await page.mouse.up();
    assert.ok(await page.evaluate(() => window.ChikoDrawingBoard.exportCanvas().getContext('2d').getImageData(0, 0, 640, 480).data.some((value, index) => index % 4 === 3 && value > 0)), 'Local drawing canvas works');
    const downloading = page.waitForEvent('download');
    await page.locator('#drawing-download').click();
    const download = await downloading;
    assert.equal(download.suggestedFilename(), 'chiko-drawing.png');
    assert.equal(await download.failure(), null);
    await page.screenshot({ path: join(output, 'drawings-' + name + '.png'), fullPage: true });
    checks.push(name + ': local blog navigation, drawing, and download');
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(failedFiles, []);
  assert.deepEqual(backendRequests, []);
  const report = { passed: true, pages: pages.length, checks, errors, failedFiles, backendRequests };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, pages: pages.length, checks: checks.length, errors, failedFiles, backendRequests }));
} finally { await browser.close(); }
