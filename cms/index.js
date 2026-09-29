import { adminRoutes } from './routes/admin.js';
import { publicRoutes } from './routes/public.js';
import { serveImage, storeImage } from './uploads.js';
import { handleError, redirect, problem } from './http.js';
import { layout } from './views/layout.js';
import { live, visible } from './models.js';
export function createCMS(store, env = process.env) {
  const admin = adminRoutes(store, env), publicRoute = publicRoutes(store);
  return {
    store,
    matches: path => path === '/:3' || path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/admin/') || path === '/blogs' || path === '/blogs/archive' || path.startsWith('/blog/') || path === '/drawings' || path.startsWith('/uploads/'),
    async route(req, res, path, url) {
      try {
        if (path === '/:3' || path.startsWith('/admin') || path.startsWith('/api/admin/')) return await admin(req, res, path, url);
        if (path.startsWith('/uploads/')) {
          if (!['GET', 'HEAD'].includes(req.method)) throw problem(405, 'Method not allowed.');
          return await serveImage(store, req, res, path.slice('/uploads/'.length));
        }
        return await publicRoute(req, res, path, url);
      } catch (error) { handleError(req, res, error, layout); }
    },
    async health() { await store.db.command({ ping: 1 }); },
    visitorStorage: {
      async list() { return store.db.collection('drawings').find(visible, { projection: { title: 1, image: 1, thumbnail: 1, description: 1, date: 1, order: 1, createdAt: 1 } }).sort({ order: 1, date: -1, createdAt: -1 }).limit(1000).toArray(); },
      async save(bytes) {
        if (await store.db.collection('drawings').countDocuments(live) >= Number(env.MAX_DRAWINGS || 1000)) throw problem(507, 'Drawing storage is full.');
        const file = await storeImage(store, { bytes, mime: 'image/png', extension: 'png' }, { visitorDrawing: true, originalName: 'Visitor drawing', uploadedAt: new Date() });
        const record = { title: 'Visitor drawing', image: file.url, thumbnail: '', description: '', date: new Date().toISOString().slice(0, 10), order: 0, published: true, createdAt: new Date(), updatedAt: new Date() };
        const result = await store.db.collection('drawings').insertOne(record);
        return { ...record, _id: result.insertedId };
      },
      async legacy(req, res, filename) {
        const drawing = await store.db.collection('drawings').findOne({ legacyFilename: filename, ...visible });
        if (!drawing) throw problem(404, 'Drawing not found.');
        return redirect(res, drawing.image, 301);
      },
    },
  };
}
