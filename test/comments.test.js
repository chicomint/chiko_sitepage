import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { connectDatabase } from '../cms/database.js';
import { createCMS } from '../cms/index.js';
import { createPresenceServer } from '../server.js';

test('comments persist, isolate posts, escape HTML, paginate, limit spam and support authenticated moderation', { timeout: 60000 }, async () => {
  const store = await connectDatabase('mongodb://127.0.0.1:27017/comments_test_' + randomBytes(8).toString('hex'));
  const env = { ADMIN_USERNAME: 'owner', ADMIN_PASSWORD: 'test-only-password', SESSION_SECRET: randomBytes(32).toString('hex'), NODE_ENV: 'development' };
  const first = { _id: new ObjectId(), slug: 'first', title: 'First', date: '2026-10-08', content: 'Post', published: true };
  const second = { ...first, _id: new ObjectId(), slug: 'second' };
  await store.db.collection('blogs').insertMany([first, second]);
  let app, origin, cookie = '', csrf;
  async function start() { app = createPresenceServer({ cms: createCMS(store, env), statsCsvPath: null, drawingsDirectory: '/tmp/chiko-comment-test-drawings' }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + app.server.address().port; }
  const req = (path, options = {}) => fetch(origin + path, { redirect: 'manual', ...options, headers: { ...(cookie ? { cookie } : {}), ...options.headers } });
  function token(post = first, offset = 3000) { const value = `${post._id}.${Date.now() - offset}.${randomBytes(16).toString('hex')}`; return value + '.' + createHmac('sha256', env.SESSION_SECRET).update(value).digest('hex'); }
  const payload = (data = {}) => ({ username: '<img src=x onerror=alert(1)>', message: '<script>alert(1)</script>\nHello', website: 'https://example.com', token: token(), ...data });
  const post = (data, headers = {}) => req('/api/comments/' + first._id, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  const adminPost = (path, data = {}) => req(path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf, ...data }) });
  try {
    await start();
    let result = await post(payload()); assert.equal(result.status, 201); const submitted = (await result.json()).comment;
    assert.ok(Date.now() - Date.parse(submitted.createdAt) < 3000);
    let html = await (await req('/blog/first')).text(); assert.match(html, /class="blog-comments"/); assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;')); assert.doesNotMatch(html, /<script>alert\(1\)/);
    assert.equal((await (await req('/api/comments/' + second._id)).json()).comments.length, 0);
    assert.equal((await post(payload())).status, 409);
    assert.equal((await post(payload({ message: 'second unique comment' }))).status, 201);
    assert.equal((await post(payload({ message: 'rate limited' }))).status, 429);
    for (const data of [payload({ message: '   ' }), payload({ message: '\u200b\ufeff' }), payload({ website: 'javascript:alert(1)' }), payload({ company: 'spam' }), payload({ token: token(second) }), payload({ token: token(first, 0) }), payload({ username: 'x'.repeat(41) }), payload({ message: 'https://x '.repeat(6) })]) {
      await store.db.collection('commentLimits').deleteMany({});
      assert.ok([400, 403].includes((await post(data)).status));
    }
    assert.equal((await post(payload(), { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await req('/admin/comments/' + submitted._id + '/hide', { method: 'POST' })).status, 401);
    let r = await req('/:3'); cookie = r.headers.get('set-cookie').split(';')[0]; csrf = (await r.text()).match(/name="csrf" value="([^"]+)"/)[1];
    r = await adminPost('/:3', { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }); assert.equal(r.status, 303); cookie = r.headers.get('set-cookie').split(';')[0];
    csrf = (await (await req('/admin')).text()).match(/name="csrf" value="([^"]+)"/)[1];
    assert.equal((await adminPost('/admin/comments/' + submitted._id + '/hide', { csrf: 'wrong' })).status, 403);
    assert.equal((await adminPost('/admin/comments/' + submitted._id + '/hide')).status, 303);
    assert.equal((await (await req('/api/comments/' + first._id)).json()).comments.length, 1);
    assert.equal((await adminPost('/admin/comments/' + submitted._id + '/show')).status, 303);
    assert.equal((await adminPost('/admin/comments/' + submitted._id + '/delete')).status, 303);
    assert.ok(await store.db.collection('comments').findOne({ _id: new ObjectId(submitted._id), deletedAt: { $exists: true } }));
    const rows = Array.from({ length: 25 }, (_, i) => ({ _id: new ObjectId(), blogId: first._id, username: 'Pagination test', message: String(i), createdAt: new Date(), hidden: false }));
    await store.db.collection('comments').insertMany(rows);
    const page1 = await (await req('/api/comments/' + first._id)).json(); const page2 = await (await req('/api/comments/' + first._id + '?before=' + page1.next)).json();
    assert.equal(page1.comments.length, 20); assert.equal(page2.comments.length, 6); assert.equal(new Set([...page1.comments, ...page2.comments].map(c => c._id)).size, 26);
    assert.equal(page1.comments[0].message, '24');
    await app.close(); app = null; await start(); assert.equal((await (await req('/api/comments/' + first._id)).json()).comments.length, 20);
    assert.equal((await req('/drawings')).status, 200);
    assert.equal((await req('/api/comments/not-an-id')).status, 404);
    env.COMMENTS_REQUIRE_APPROVAL = 'true'; await app.close(); app = null; await start(); await store.db.collection('commentLimits').deleteMany({});
    r = await post(payload({ username: 'Visitor', message: 'Waiting for approval' })); assert.equal(r.status, 201); assert.equal((await r.json()).pending, true);
    assert.ok(await store.db.collection('comments').findOne({ message: 'Waiting for approval', hidden: true }));
  } finally { await app?.close(); await store.db.dropDatabase(); await store.close(); }
});
