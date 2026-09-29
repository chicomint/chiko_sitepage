import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { slugify } from './models.js';
import { renderBBCode } from './bbcode.js';
import { storeImage, validateImage } from './uploads.js';
import sharp from 'sharp';
import { cleanUrl } from './urls.js';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = resolve(new URL('..', import.meta.url).pathname);
const absolute = value => /^https?:|^\//.test(value) ? cleanUrl(value) : '/' + value;
export function htmlToBBCode(html) {
  const $ = load(html, {}, false);
  function node(n) {
    if (n.type === 'text') return n.data.replace(/\[/g, '[literal-open]');
    if (n.type !== 'tag') return '';
    const inner = () => (n.children || []).map(node).join('');
    const tags = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', s: 's', strike: 's', blockquote: 'quote', center: 'center', code: 'code' };
    if (tags[n.name]) return `[${tags[n.name]}]${inner()}[/${tags[n.name]}]`;
    if (n.name === 'br') return '\n';
    if (n.name === 'p') return inner() + '\n\n';
    if (n.name === 'img') return `[img]${absolute(n.attribs.src)}[/img]`;
    if (n.name === 'a') return `[url=${absolute(n.attribs.href || '')}]${inner()}[/url]`;
    if (n.name === 'video') {
      const src = n.attribs.src || n.children.find(c => c.name === 'source')?.attribs.src;
      return src ? `[video]${absolute(src)}[/video]` + inner() : inner();
    }
    if (n.name === 'source') return '';
    if (n.name === 'user') return '';
    return inner();
  }
  return $.root().contents().toArray().map(node).join('').trim();
}
export async function sourceBlogs() {
  const raw = await readFile(join(root, 'legacy/all_blog.html'), 'utf8');
  const markers = [...raw.matchAll(/<p>\s*<user>chicomint \((\d{1,2}\/\d{1,2}\/\d{4})\)<\/user>/g)];
  const posts = markers.map((m, index) => {
    const end = markers[index + 1]?.index || raw.indexOf('</body>', m.index);
    let fragment = raw.slice(m.index + m[0].length, end).replace(/<\/p>\s*$/, '').trim();
    const [month, day, year] = m[1].split('/');
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const $ = load(fragment, {}, false);
    const title = index === 0 ? 'Long Break, Website Updates & Chickens' : $('i').first().text().trim() || `Journal — ${date}${markers.filter(x => x[1] === m[1]).length > 1 ? ` (${markers.slice(0, index + 1).filter(x => x[1] === m[1]).length})` : ''}`;
    const content = htmlToBBCode(fragment);
    return { legacyKey: `all-blog:${index}:${date}`, title, date, content, slug: slugify(title), legacy: { source: 'all_blog.html', position: index, originalDate: m[1], html: fragment, sha256: sha(fragment), urls: ['/all_blog.html', '/all_blog', ...(index === 0 ? ['/blogs.html'] : [])] } };
  });
  const slugs = new Set();
  for (const post of posts) { const base = post.slug; let i = 2; while (slugs.has(post.slug)) post.slug = `${base}-${i++}`; slugs.add(post.slug); }
  if (!posts.length) throw new Error('No legacy blogs found; migration stopped.');
  return { posts, raw };
}
async function importLocalImage(store, url) {
  let filename;
  if (url.startsWith('/picture/')) {
    filename = url.slice(1);
    if (!/^picture\/[a-zA-Z0-9_.-]+$/.test(filename)) throw new Error('Unsafe legacy image path.');
  } else {
    let manifest = [];
    try { manifest = JSON.parse(await readFile(join(root, 'legacy/blog-images/manifest.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const entry = manifest.find(item => item.url === url && item.filename);
    if (!entry) return url;
    if (!/^[a-f0-9]{64}\.(png|jpeg|gif|webp)$/.test(entry.filename)) throw new Error('Invalid legacy image manifest.');
    filename = 'legacy/blog-images/' + entry.filename;
  }
  const existing = await store.db.collection('legacyAssets').findOne({ _id: url });
  if (existing) return existing.url;
  const bytes = await readFile(join(root, filename));
  const ext = filename.split('.').pop().toLowerCase();
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png', gif: 'image/gif' }[ext];
  // These are trusted, version-controlled originals; retain their exact bytes and quality.
  const meta = await sharp(bytes, { limitInputPixels: 60000000 }).metadata();
  if (!mime || !['jpeg', 'png', 'webp', 'gif'].includes(meta.format)) throw new Error('Invalid legacy image.');
  const validated = { bytes, mime, extension: ext };
  const stored = await storeImage(store, validated, { originalName: filename, legacyUrl: url, uploadedAt: new Date() });
  await store.db.collection('legacyAssets').updateOne({ _id: url }, { $setOnInsert: { url: stored.url, sourceHash: sha(bytes) } }, { upsert: true });
  return stored.url;
}
export async function migrate(store, { drawingsDirectory = process.env.LEGACY_DRAWINGS_DIRECTORY || process.env.DRAWINGS_DIRECTORY || join(root, 'legacy/drawings') } = {}) {
  // A lease prevents concurrent boot migrations. No deletion or replacement of source data.
  const locks = store.db.collection('migrationLocks');
  try { await locks.insertOne({ _id: 'legacy-v1', expiresAt: new Date(Date.now() + 15 * 60000) }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    const previous = await locks.findOneAndUpdate({ _id: 'legacy-v1', expiresAt: { $lt: new Date() } }, { $set: { expiresAt: new Date(Date.now() + 15 * 60000) } }, { returnDocument: 'after' });
    if (!previous) throw new Error('Another migration is running; retry when it finishes.');
  }
  try {
    const { posts, raw } = await sourceBlogs();
    await store.db.collection('sourceBackups').updateOne({ _id: 'all_blog:' + sha(raw) }, { $setOnInsert: { html: raw, capturedAt: new Date() } }, { upsert: true });
    for (const post of posts) {
      const existing = await store.db.collection('blogs').findOne({ legacyKey: post.legacyKey });
      let content = post.content;
        for (const match of [...content.matchAll(/\[img\]([^]*?)\[\/img\]/g)]) content = content.replace(match[0], `[img]${await importLocalImage(store, match[1])}[/img]`);
      if (!existing) {
        const images = [...content.matchAll(/\[img\]([^]*?)\[\/img\]/g)].map(m => m[1]);
        const record = { ...post, content, images, coverImage: '', published: true, createdAt: new Date(), updatedAt: new Date(), importedContentHash: sha(content) };
        await store.db.collection('blogs').updateOne({ legacyKey: post.legacyKey }, { $setOnInsert: record }, { upsert: true });
      }
      if (existing && sha(existing.content) === existing.importedContentHash && existing.content !== content) {
        await store.db.collection('blogs').updateOne({ _id: existing._id }, { $set: { content, images: [...content.matchAll(/\[img\]([^]*?)\[\/img\]/g)].map(m => m[1]), importedContentHash: sha(content) } });
      }
      const saved = await store.db.collection('blogs').findOne({ legacyKey: post.legacyKey });
      if (saved.legacy.sha256 !== post.legacy.sha256 || saved.legacy.html !== post.legacy.html || !renderBBCode(saved.content)) throw new Error('Blog migration verification failed.');
      if (!existing && (saved.title !== post.title || saved.date !== post.date || sha(saved.content) !== saved.importedContentHash)) throw new Error('Blog data verification failed.');
      await store.db.collection('slugHistory').updateOne({ slug: saved.slug }, { $setOnInsert: { blogId: saved._id } }, { upsert: true });
    }
    let entries;
    try { entries = await readdir(drawingsDirectory, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
    const filenames = entries.filter(f => f.isFile() && /^\d{13}-[a-f0-9]{32}\.png$/.test(f.name)).map(f => f.name).sort();
    for (const filename of filenames) {
      const legacyKey = 'drawing:' + filename;
      const filePath = join(drawingsDirectory, filename);
      if ((await lstat(filePath)).isSymbolicLink()) throw new Error('Invalid legacy drawing.');
      const bytes = await readFile(filePath);
      let saved = await store.db.collection('drawings').findOne({ legacyKey });
      if (!saved) {
        const file = await storeImage(store, { bytes, mime: 'image/png', extension: 'png' }, { originalName: filename, visitorDrawing: true, legacyUrl: '/drawings/' + filename });
        const time = new Date(Number(filename.slice(0, 13)));
        await store.db.collection('drawings').updateOne({ legacyKey }, { $setOnInsert: { title: 'Visitor drawing', image: file.url, thumbnail: '', description: '', date: time.toISOString().slice(0, 10), order: 0, published: true, createdAt: time, updatedAt: time, legacyKey, legacyFilename: filename, legacyImage: file.url, legacyHash: sha(bytes) } }, { upsert: true });
        saved = await store.db.collection('drawings').findOne({ legacyKey });
      }
      if (saved.legacyHash !== sha(bytes)) throw new Error('Drawing source has changed; migration stopped.');
      if (!saved.legacyImage) await store.db.collection('drawings').updateOne({ _id: saved._id }, { $set: { legacyImage: saved.image } });
      const imageId = (saved.legacyImage || saved.image).split('/').pop();
      const file = await store.db.collection('images.files').findOne({ _id: (await import('mongodb')).ObjectId.createFromHexString(imageId) });
      if (!file || file.metadata.sha256 !== sha(bytes)) throw new Error('Drawing storage verification failed.');
    }
    const result = { blogs: posts.length, drawings: filenames.length, verifiedAt: new Date() };
    await store.db.collection('migrations').updateOne({ _id: 'legacy-v1' }, { $set: result }, { upsert: true });
    return result;
  } finally { await locks.deleteOne({ _id: 'legacy-v1' }); }
}
