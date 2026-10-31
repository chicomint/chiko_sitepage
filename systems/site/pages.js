import { readFileSync } from 'node:fs';
import { escapeHtml as e } from './http.js';
import { cleanHtml } from './urls.js';
const original = readFileSync(new URL('../../drawings.html', import.meta.url), 'utf8');
const head = cleanHtml(original.slice(0, original.indexOf('<main')))
  .replace(/ aria-current="page"/g, '')
  .replace(/<script src="\/draw\/(?:board|gallery)\.js[^]*?<\/script>/g, '')
  .replace(/(?:href|src)="(?!(?:https?:|\/|#|data:))([^"#]+)"/g, match => match.replace('="', '="/'));
const footer = original.slice(original.indexOf('<footer'));
export const layout = (title, content) => head.replace(/<title>[^]*?<\/title>/, `<title>${e(title)} · chicomint</title>`) + `<main id="main-content" class="my_stuff"><h1>${e(title)}</h1>${content}</main>` + footer;
const dateLabel = date => { const [year, month, day] = date.split('-'); return `${month}/${day}/${year}`; };
export function drawingsPage(drawings) {
  let html = cleanHtml(readFileSync(new URL('../../drawings.html', import.meta.url), 'utf8'));
  const cards = drawings.map(d => `<figure><a href="${e(d.image)}"><img src="${e(d.thumbnail || d.image)}" alt="${e(d.title)}" loading="lazy"></a><figcaption><time datetime="${e(d.date)}">${dateLabel(d.date)}</time></figcaption></figure>`).join('');
  return html.replace('<div id="drawing-gallery" class="drawing-gallery"></div>', `<div id="drawing-gallery" class="drawing-gallery">${cards}</div>`)
    .replace('Loading drawings...', drawings.length ? '' : 'No drawings yet. Leave the first one!')
    .replace('Enable JavaScript to draw and view the gallery.', 'Enable JavaScript to use the drawing canvas.');
}
