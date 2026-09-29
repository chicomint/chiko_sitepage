import { visible } from '../models.js';
import { send, redirect, problem } from '../http.js';
import { blogList, blogPage, archivePage, drawingsPage } from '../views/public.js';
export function publicRoutes(store) {
  return async (req, res, path, url) => {
    if (!['GET', 'HEAD'].includes(req.method)) throw problem(405, 'Method not allowed.');
    if (path === '/blogs') {
      const page = Math.max(1, Math.min(10000, parseInt(url.searchParams.get('page'), 10) || 1));
      const posts = await store.db.collection('blogs').find(visible).sort({ date: -1, 'legacy.position': 1, createdAt: -1 }).skip((page - 1) * 50).limit(51).toArray();
      return send(res, 200, blogList(posts.slice(0, 50), posts.length > 50, page));
    }
    if (path === '/blogs/archive') return send(res, 200, archivePage(await store.db.collection('blogs').find(visible).sort({ date: -1, 'legacy.position': 1, createdAt: -1 }).toArray()));
    if (path === '/drawings') return send(res, 200, drawingsPage(await store.db.collection('drawings').find(visible).sort({ order: 1, date: -1, createdAt: -1 }).limit(1000).toArray()));
    const slug = path.slice('/blog/'.length);
    const post = await store.db.collection('blogs').findOne({ slug, ...visible });
    if (post) return send(res, 200, blogPage(post));
    const history = await store.db.collection('slugHistory').findOne({ slug });
    const moved = history && await store.db.collection('blogs').findOne({ _id: history.blogId, ...visible });
    if (moved) return redirect(res, '/blog/' + moved.slug, 301);
    throw problem(404, 'Blog post not found.');
  };
}
