import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { load } from 'cheerio';
import { createPresenceServer } from '../server.js';

test('legacy HTML blogs preserve all posts, work without a database, and serve saved images', async t => {
  const folder = await mkdtemp('/tmp/chiko-legacy-blog-');
  const app = createPresenceServer({ statsCsvPath: null, drawingsDirectory: join(folder, 'drawings') });
  t.after(async () => { await app.close(); await rm(folder, { recursive: true, force: true }); });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  // Checksums of the original legacy writing, independent of asset locations.
  for (const [path, count, textHash] of [
    ['/blogs', 1, 'c62d10fc0491e8f701c1b8e56b316ab266cbfdf066129175ac2b49936c440a9c'],
    ['/all_blog', 35, 'bc3fe5564fc685928dc83e1c660c09af3559c2578cc9f3520d77e0a1d74404a0'],
  ]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    const html = await response.text(), $ = load(html);
    assert.equal($('user').length, count);
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    assert.equal(createHash('sha256').update(text).digest('hex'), textHash, 'Original writing is preserved');
    assert.doesNotMatch(html, /comment-form|comments\.js|comments\.css|blog-list|blog-body|\/api\/comments|\/cms\.css/);
    for (const src of new Set($('img').map((_, el) => $(el).attr('src')).get().filter(src => src.startsWith('/')))) {
      const image = await fetch(origin + src);
      assert.equal(image.status, 200, src);
      assert.ok((await image.arrayBuffer()).byteLength > 0);
    }
    for (const href of $('a').map((_, el) => $(el).attr('href')).get().filter(href => href.startsWith('/'))) assert.equal((await fetch(origin + href)).status, 200, href);
    assert.equal((await fetch(origin + path, { method: 'HEAD' })).status, 200);
  }
  for (const [path, target] of [['/blogs.html', '/blogs'], ['/blogs_showcase.html', '/blogs'], ['/all_blog.html', '/all_blog'], ['/blogs/archive', '/all_blog'], ['/blog/long-break-website-updates-chickens', '/all_blog']]) {
    const response = await fetch(origin + path + '?from=old', { redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), target + '?from=old');
  }
  for (const path of ['/:3', '/admin', '/admin/drawings', '/admin/uploads', '/admin/logout', '/api/admin/uploads', '/admin.js', '/cms.css', '/cms/auth.js', '/admin/blogs', '/admin/blogs/new', '/admin/comments', '/api/admin/preview', '/api/comments/0123456789abcdef01234567', '/comments.js', '/comments.css', '/blog-images/manifest.json', '/legacy/all_blog.html', '/cms/bbcode.js']) {
    for (const method of ['GET', 'HEAD', 'POST']) assert.equal((await fetch(origin + path, { method })).status, 404, method + ' ' + path);
  }
  assert.equal((await fetch(origin + '/blogs', { method: 'POST' })).status, 405);
});
