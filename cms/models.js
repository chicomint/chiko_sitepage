import { ObjectId } from 'mongodb';
import { problem } from './http.js';
import { safeUrl } from './bbcode.js';
export function id(value) { if (!/^[a-f0-9]{24}$/.test(value || '')) throw problem(404, 'Not found.'); return new ObjectId(value); }
export function slugify(title) { return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 110).replace(/-$/, '') || 'post'; }
function text(value, name, max, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw problem(400, `${name} is required and must be at most ${max} characters.`);
  return value.trim();
}
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw problem(400, 'Enter a valid date.');
  return value;
}
function url(value, required = false) { if (!value && !required) return ''; const result = safeUrl(value, true); if (!result) throw problem(400, 'Use a valid HTTP(S) or local image URL.'); return result; }
function published(value) { if (![undefined, false, true, 'on', 'true', 'false'].includes(value)) throw problem(400, 'Invalid publication status.'); return [true, 'on', 'true'].includes(value); }
export function blogData(data) {
  const title = text(data.title, 'Title', 200);
  const slug = data.slug ? text(data.slug, 'Slug', 120) : slugify(title);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw problem(400, 'Use lowercase words separated by hyphens for the slug.');
  const content = text(data.content, 'Content', 200000);
  return { title, slug, date: date(data.date), content, coverImage: url(data.coverImage),
    images: [...content.matchAll(/\[img\]([^]*?)\[\/img\]/gi)].map(m => safeUrl(m[1].trim(), true)).filter(Boolean), published: published(data.published), updatedAt: new Date() };
}
export function drawingData(data) {
  const order = Number(data.order || 0);
  if (!Number.isSafeInteger(order) || Math.abs(order) > 1000000) throw problem(400, 'Order must be an integer between -1000000 and 1000000.');
  return { title: text(data.title, 'Title', 200), description: text(data.description || '', 'Description', 4000, false), image: url(data.image, true),
    thumbnail: url(data.thumbnail), date: date(data.date), order, published: published(data.published), updatedAt: new Date() };
}
export const live = { deletedAt: { $exists: false } };
export const visible = { ...live, published: true };
