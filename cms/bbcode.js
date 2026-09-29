import sanitizeHtml from 'sanitize-html';
import { escapeHtml as e } from './http.js';
import { cleanUrl } from './urls.js';
export function safeUrl(value, image = false) {
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x20\x7f\\<>"']/.test(value)) return '';
  if (/^\/(?!\/)/.test(value)) return cleanUrl(value);
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? cleanUrl(value) : ''; } catch { return ''; }
}
const styles = { color: [/^(?:#[a-fA-F0-9]{3}(?:[a-fA-F0-9]{3})?|red|green|blue|yellow|purple|pink|orange|white|black|cyan|lime|teal)$/], 'font-size': [/^(?:[89]|[12][0-9]|3[0-2])px$/], 'text-align': [/^center$/] };
export function renderBBCode(input, nesting = 0) {
  if (nesting > 30) return e(input);
  const source = String(input || '').slice(0, 200000);
  let pos = 0;
  function parse(end = '', depth = 0) {
    let out = '';
    while (pos < source.length) {
      if (end && source.slice(pos, pos + end.length).toLowerCase() === end) { pos += end.length; return out; }
      const token = source.slice(pos).match(/^\[(b|i|u|s|url|img|quote|code|list|center|color|size|video)(?:=([^\]\r\n]*))?\]/i);
      if (!token || depth > 30) {
        if (source.startsWith('[literal-open]', pos)) { pos += 14; out += '['; continue; }
        const c = source[pos++]; out += c === '\n' ? '<br>' : e(c); continue;
      }
      pos += token[0].length;
      const tag = token[1].toLowerCase(), arg = token[2] || '', closing = `[/${tag}]`;
      if (['code', 'img', 'video'].includes(tag)) {
        const stop = source.toLowerCase().indexOf(closing, pos);
        if (stop < 0) { out += e(token[0]); continue; }
        const raw = source.slice(pos, stop); pos = stop + closing.length;
        if (tag === 'code') out += `<pre><code>${e(raw)}</code></pre>`;
        else {
          const url = safeUrl(raw.trim(), true);
          if (url) out += tag === 'img' ? `<img src="${e(url)}" alt="" loading="lazy">` : `<video controls preload="metadata" src="${e(url)}"></video>`;
          else out += e(raw);
        }
        continue;
      }
      // List markers are handled before recursive parsing so nested inline markup stays intact.
      if (tag === 'list') {
        const stop = source.toLowerCase().indexOf(closing, pos);
        if (stop < 0) { out += e(token[0]); continue; }
        const raw = source.slice(pos, stop); pos = stop + closing.length;
        out += '<ul>' + raw.split('[*]').filter(s => s.trim()).map(s => `<li>${renderBBCode(s.trim(), nesting + 1)}</li>`).join('') + '</ul>'; continue;
      }
      const start = pos; const content = parse(closing, depth + 1);
      const mapped = { b: 'strong', i: 'em', u: 'u', s: 's', quote: 'blockquote' }[tag];
      if (mapped) out += `<${mapped}>${content}</${mapped}>`;
      else if (tag === 'url') {
        const url = safeUrl(arg || source.slice(start, pos - closing.length));
        out += url ? `<a href="${e(url)}" rel="noopener noreferrer">${content}</a>` : content;
      } else if (tag === 'center') out += `<div style="text-align:center">${content}</div>`;
      else if (tag === 'color' && styles.color[0].test(arg)) out += `<span style="color:${e(arg)}">${content}</span>`;
      else if (tag === 'size' && /^(?:[89]|[12][0-9]|3[0-2])$/.test(arg)) out += `<span style="font-size:${arg}px">${content}</span>`;
      else out += content;
    }
    return out;
  }
  return sanitizeHtml(parse(), {
    allowedTags: ['strong', 'em', 'u', 's', 'a', 'img', 'blockquote', 'pre', 'code', 'ul', 'li', 'br', 'div', 'span', 'video'],
    allowedAttributes: { a: ['href', 'rel'], img: ['src', 'alt', 'loading'], span: ['style'], div: ['style'], video: ['src', 'controls', 'preload'] },
    allowedStyles: { '*': styles }, allowedSchemes: ['http', 'https'], allowProtocolRelative: false,
  });
}
