import { readFileSync } from 'node:fs';
import { escapeHtml as e } from '../http.js';
import { cleanHtml } from '../urls.js';
const original = readFileSync(new URL('../../blogs_showcase.html', import.meta.url), 'utf8');
const head = cleanHtml(original.slice(0, original.indexOf('<main'))).replace(/(?:href|src)="(?!(?:https?:|\/|#|data:))([^"#]+)"/g, match => match.replace('="', '="/'));
const footer = original.slice(original.indexOf('    <footer>'));
export const field = (name, value = '', type = 'text', required = false) => `<label>${e(name)}<input name="${e(name)}" type="${type}" value="${e(value)}" ${required ? 'required' : ''}></label>`;
export const csrfField = session => `<input type="hidden" name="csrf" value="${e(session.csrf)}">`;
export function layout(title, content, session = null) {
  const prefix = head.replace(/<title>[^]*?<\/title>/, `<title>${e(title)} · chicomint</title>`)
    .replace('</head>', '<link rel="stylesheet" href="/cms.css"><script src="/admin.js" defer></script></head>')
    .replace(/<script src="\/(?:realtime|cursor)\.js[^]*?<\/script>/g, match => session ? '' : match);
  const nav = session?.authenticated ? `<nav class="admin-nav" aria-label="Admin"><a href="/admin">Dashboard</a> · <a href="/admin/blogs">Blogs</a> · <a href="/admin/blogs/new">New Blog</a> · <a href="/admin/drawings">Drawings</a> · <a href="/admin/uploads">Uploads</a><form action="/admin/logout" method="post">${csrfField(session)}<button>Logout</button></form></nav>` : '';
  return prefix + nav + `<main>${content}</main>` + footer;
}
export const dateLabel = date => { const [y, m, d] = date.split('-'); return `${m}/${d}/${y}`; };
