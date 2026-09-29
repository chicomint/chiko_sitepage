export const problem = (status, message) => Object.assign(new Error(message), { status });
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
export const json = (res, status, data) => send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
export const redirect = (res, location, status = 303) => { res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' }); res.end(); };
export async function readBody(req, max = 512 * 1024) {
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw problem(415, 'Content encoding is unsupported.');
  if (Number(req.headers['content-length']) > max) throw problem(413, 'Request is too large.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw problem(413, 'Request is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function readForm(req) {
  const type = req.headers['content-type']?.split(';')[0];
  const raw = (await readBody(req)).toString('utf8');
  if (type === 'application/x-www-form-urlencoded') return Object.fromEntries(new URLSearchParams(raw));
  if (type === 'application/json') {
    try { const value = JSON.parse(raw); if (value && typeof value === 'object' && !Array.isArray(value)) return value; } catch {}
    throw problem(400, 'Invalid request body.');
  }
  throw problem(415, 'Use a form or JSON request.');
}
export function handleError(req, res, error, page) {
  if (res.headersSent || res.destroyed) { res.destroy(); return; }
  const status = error.code === 11000 ? 409 : (error.status || 500);
  const message = error.code === 11000 ? 'That slug is already in use. Choose another.' : error.status ? error.message : 'Something went wrong. Please try again.';
  if (status >= 500) console.error(JSON.stringify({ event: 'cms_error', status }));
  if (req.method !== 'GET') req.resume();
  if (req.url.startsWith('/api/')) json(res, status, { error: message });
  else send(res, status, page('Please try again', `<p role="alert">${escapeHtml(message)}</p><p><a href="/admin">Admin dashboard</a> · <a href="/">Homepage</a></p>`));
}
