export const problem = (status, message) => Object.assign(new Error(message), { status });
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
export const json = (res, status, data) => send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
export const redirect = (res, location, status = 303) => { res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' }); res.end(); };
export function handleError(req, res, error, page) {
  if (res.headersSent || res.destroyed) { res.destroy(); return; }
  const status = error.code === 11000 ? 409 : (error.status || 500);
  const message = error.code === 11000 ? 'That item already exists.' : error.status ? error.message : 'Something went wrong. Please try again.';
  if (status >= 500) console.error(JSON.stringify({ event: 'site_error', status }));
  if (req.method !== 'GET') req.resume();
  if (req.url.startsWith('/api/')) json(res, status, { error: message });
  else send(res, status, page('Please try again', `<p role="alert">${escapeHtml(message)}</p><p><a href="/">Homepage</a></p>`));
}
