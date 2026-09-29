import { readFileSync } from 'node:fs';
import { layout, dateLabel } from './layout.js';
import { escapeHtml as e } from '../http.js';
import { renderBBCode } from '../bbcode.js';
import { cleanHtml } from '../urls.js';
export const article = post => `<article class="blog-body"><h2>${e(post.title)}</h2><p><user>chicomint (${dateLabel(post.date)})</user></p>${post.coverImage ? `<img src="${e(post.coverImage)}" alt="">` : ''}${renderBBCode(post.content)}</article>`;
export const blogPage = post => layout(post.title, `<a href="/blogs">| Back to blogs |</a>${article(post)}`);
export const blogList = (posts, more = false, page = 1) => layout('blogs', `<div class="blog-showcase"><h2>Blogs</h2><p class="intro">Pick a post to read&lt;3</p><ul class="blog-list">${posts.map(p => `<li><a href="/blog/${e(p.slug)}"><span class="blog-date">${dateLabel(p.date)}</span><span class="blog-title">${e(p.title)}</span></a></li>`).join('')}</ul>${page > 1 ? `<a href="/blogs?page=${page - 1}">Newer posts</a> ` : ''}${more ? `<a href="/blogs?page=${page + 1}">Older posts</a>` : ''}<p><a href="/blogs/archive">Read the full archive</a></p></div>`);
export const archivePage = posts => layout('All posts', `<a href="/blogs">| Back |</a>${posts.map(article).join('<hr>')}`);
export function drawingsPage(drawings) {
  let html = cleanHtml(readFileSync(new URL('../../drawings.html', import.meta.url), 'utf8'));
  const cards = drawings.map(d => `<figure><a href="${e(d.image)}"><img src="${e(d.thumbnail || d.image)}" alt="${e(d.title)}" loading="lazy"></a><figcaption>${e(d.title)}<br><small>${dateLabel(d.date)}</small>${d.description ? `<p>${e(d.description)}</p>` : ''}</figcaption></figure>`).join('');
  return html.replace('<div id="drawing-gallery" class="drawing-gallery"></div>', `<div id="drawing-gallery" class="drawing-gallery">${cards}</div>`)
    .replace('Loading drawings...', drawings.length ? '' : 'No drawings yet. Leave the first one!')
    .replace('Enable JavaScript to draw and view the gallery.', 'Enable JavaScript to use the drawing canvas.');
}
