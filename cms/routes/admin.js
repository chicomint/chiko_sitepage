import { ObjectId } from 'mongodb';
import { createAuth } from '../auth.js';
import { id, live, blogData, drawingData } from '../models.js';
import { problem, readBody, readForm, send, json, redirect } from '../http.js';
import { MAX_UPLOAD, validateImage, storeImage } from '../uploads.js';
import { layout } from '../views/layout.js';
import { article } from '../views/public.js';
import * as views from '../views/admin.js';
export function adminRoutes(store, env) {
  const db = store.db, auth = createAuth(db, env);
  const uploads = () => db.collection('images.files').find({ 'metadata.archived': { $ne: true } }).sort({ uploadDate: -1 });
  return async (req, res, path, url) => {
    let session = await auth.get(req);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://tilomitra.github.io; img-src 'self' https: http: data:; font-src 'self'; media-src 'self' https: http:; connect-src 'self'; frame-src 'self' about:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    if (path === '/:3') {
      if (req.method === 'GET') {
        if (session?.authenticated) return redirect(res, '/admin');
        if (!session) { await auth.limit(req, false); session = await auth.issue(res); }
        return send(res, 200, views.loginPage(session));
      }
      if (req.method !== 'POST') throw problem(405, 'Method not allowed.');
      const data = await readForm(req);
      try { await auth.login(req, res, session, data); }
      catch (error) { if (error.status === 429) res.setHeader('Retry-After', '900'); throw error; }
      return redirect(res, '/admin');
    }
    if (!session?.authenticated) {
      if (path.startsWith('/api/') || req.method !== 'GET') throw problem(401, 'Please log in.');
      return redirect(res, '/:3');
    }
    if (!['GET', 'POST'].includes(req.method)) throw problem(405, 'Method not allowed.');
    if (path === '/api/admin/uploads') {
      if (req.method !== 'POST') throw problem(405, 'Method not allowed.');
      auth.csrf(req, session, req.headers['x-csrf-token']);
      let filename;
      try { filename = decodeURIComponent(req.headers['x-filename'] || ''); } catch { throw problem(400, 'Invalid filename.'); }
      if (filename.length > 200) throw problem(400, 'Filename is too long.');
      const mime = req.headers['content-type']?.split(';')[0];
      const image = await validateImage(await readBody(req, MAX_UPLOAD), filename, mime);
      const file = await storeImage(store, image, { originalName: filename, uploadedAt: new Date(), contentType: image.mime, size: image.bytes.length });
      return json(res, 201, { url: file.url, id: file._id });
    }
    const data = req.method === 'POST' ? await readForm(req) : null;
    if (data) auth.csrf(req, session, data.csrf || req.headers['x-csrf-token']);
    if (path === '/admin/logout' && data) { await auth.logout(res, session); return redirect(res, '/:3'); }
    if (path === '/api/admin/preview' && data) return send(res, 200, layout('Preview', article(blogData(data))).replace(/<script[^]*?<\/script>/g, ''));
    if (path === '/admin' && !data) {
      const [blogs, drawings, count] = await Promise.all([db.collection('blogs').countDocuments(live), db.collection('drawings').countDocuments(live), db.collection('images.files').countDocuments({ 'metadata.archived': { $ne: true } })]);
      return send(res, 200, views.dashboard(session, { blogs, drawings, uploads: count }));
    }
    const match = path.match(/^\/admin\/(blogs|drawings|uploads)(?:\/(new|[a-f0-9]{24})(\/delete)?)?$/);
    if (!match) throw problem(404, 'Page not found.');
    const [, type, key, deleting] = match;
    const collection = db.collection(type === 'uploads' ? 'images.files' : type);
    const page = Math.max(1, Math.min(10000, parseInt(url.searchParams.get('page'), 10) || 1));
    if (!key && !data) {
      const items = await (type === 'uploads' ? uploads() : collection.find(live).sort(type === 'blogs' ? { date: -1, createdAt: -1 } : { order: 1, date: -1 })).skip((page - 1) * 50).limit(51).toArray();
      return send(res, 200, type === 'uploads' ? views.uploadsPage(session, items.slice(0, 50), page, items.length > 50) : views.listPage(session, type, items.slice(0, 50), page, items.length > 50));
    }
    let item;
    if (key && key !== 'new') { item = await collection.findOne({ _id: id(key), ...live }); if (!item) throw problem(404, 'Item not found.'); }
    if (deleting && item) {
      if (!data) return send(res, 200, views.confirmDelete(session, type, item));
      if (data.confirm !== 'delete') throw problem(400, 'Deletion must be confirmed.');
      await collection.updateOne({ _id: item._id }, { $set: type === 'uploads' ? { 'metadata.archived': true } : { deletedAt: new Date(), published: false } });
      return redirect(res, `/admin/${type}`);
    }
    if (type === 'uploads' || !key) throw problem(404, 'Page not found.');
    if (!data) return send(res, 200, views.editor(session, type, item, await uploads().limit(200).toArray()));
    const record = type === 'blogs' ? blogData(data) : drawingData(data);
    const _id = item?._id || new ObjectId();
    if (type === 'blogs') {
      // Reserve slugs permanently, including former slugs, to prevent URL reuse.
      try { await db.collection('slugHistory').updateOne({ slug: record.slug, blogId: _id }, { $setOnInsert: { slug: record.slug, blogId: _id } }, { upsert: true }); }
      catch (error) { if (error.code === 11000) throw problem(409, 'That slug is already in use.'); throw error; }
      if (item && item.slug !== record.slug) await db.collection('slugHistory').updateOne({ slug: item.slug }, { $setOnInsert: { blogId: _id } }, { upsert: true });
    }
    if (item) await collection.updateOne({ _id }, { $set: record });
    else await collection.insertOne({ _id, ...record, createdAt: new Date() });
    return redirect(res, `/admin/${type}`);
  };
}
