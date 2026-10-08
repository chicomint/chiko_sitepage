import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { connectDatabase } from '../cms/database.js';
import { storeImage } from '../cms/uploads.js';
import { createCMS } from '../cms/index.js';
import { createPresenceServer } from '../server.js';
import { removeCommentAvatars } from '../scripts/remove-comment-avatars.js';

test('avatar removal deletes only comment avatar files and fields, and disables uploads', { timeout: 30000 }, async () => {
  const store = await connectDatabase('mongodb://127.0.0.1:27017/avatar_removal_' + randomBytes(8).toString('hex'));
  const env = { ADMIN_USERNAME: 'test-owner', ADMIN_PASSWORD: 'test-only-password', SESSION_SECRET: randomBytes(32).toString('hex') };
  const blog = { _id: new ObjectId(), slug: 'test', title: 'Test', content: 'Post', date: '2026-10-08', published: true };
  const image = { bytes: Buffer.from('isolated GridFS cleanup fixture'), mime: 'image/png', extension: 'png' };
  let app;
  try {
    const avatar = await storeImage(store, image, { commentAvatar: true });
    const ordinary = await storeImage(store, image);
    await store.db.collection('blogs').insertOne({ ...blog, coverImage: ordinary.url });
    await store.db.collection('drawings').insertOne({ title: 'Stored drawing', image: ordinary.url, published: true });
    const comment = { _id: new ObjectId(), blogId: blog._id, username: 'Visitor', message: 'Keep this comment', avatar: avatar.url, createdAt: new Date() };
    await store.db.collection('comments').insertOne(comment);
    const dryRun = await removeCommentAvatars(store); assert.equal(dryRun.before.avatarFiles, 1); assert.equal(dryRun.before.avatarFields, 1);
    assert.ok(await store.db.collection('images.files').findOne({ _id: avatar._id }));
    assert.equal((await store.db.collection('comments').findOne({ _id: comment._id })).avatar, avatar.url);
    const result = await removeCommentAvatars(store, true); assert.equal(result.filesRemoved, 1); assert.equal(result.fieldsRemoved, 1);
    assert.deepEqual(await store.db.collection('comments').findOne({ _id: comment._id }), Object.fromEntries(Object.entries(comment).filter(([key]) => key !== 'avatar')));
    assert.ok(await store.db.collection('images.files').findOne({ _id: ordinary._id }));
    assert.equal(await store.db.collection('images.chunks').countDocuments({ files_id: avatar._id }), 0);
    assert.equal(await store.db.collection('images.chunks').countDocuments({ files_id: ordinary._id }), 1);
    assert.equal((await removeCommentAvatars(store, true)).filesRemoved, 0, 'Cleanup is idempotent');
    app = createPresenceServer({ cms: createCMS(store, env), statsCsvPath: null });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + app.server.address().port;
    const endpoint = origin + '/api/comments/' + blog._id;
    const value = `${blog._id}.${Date.now() - 3000}.${randomBytes(16).toString('hex')}`;
    const payload = { username: 'Visitor', message: 'Normal comments still work', token: value + '.' + createHmac('sha256', env.SESSION_SECRET).update(value).digest('hex') };
    const send = data => fetch(endpoint, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal((await send({ ...payload, avatar: ordinary.url })).status, 400);
    const form = new FormData(); form.append('avatar', new Blob([image.bytes], { type: 'image/png' }), 'avatar.png');
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { Origin: origin }, body: form })).status, 415);
    assert.equal((await send(payload)).status, 201);
    const html = await (await fetch(origin + '/blog/test')).text(); assert.doesNotMatch(html, /name="avatar"|Upload Avatar|comment-avatar-preview|comment-initial|class="comment-avatar"/);
    const listing = await (await fetch(endpoint)).json(); assert.ok(listing.comments.every(row => !Object.hasOwn(row, 'avatar')));
    assert.equal((await fetch(origin + avatar.url)).status, 404);
    assert.equal((await fetch(origin + ordinary.url)).status, 200);
  } finally { await app?.close(); await store.db.dropDatabase(); await store.close(); }
});
