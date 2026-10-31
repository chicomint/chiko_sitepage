const aliases = { '/index': '/', '/blogs_showcase': '/blogs', '/blogs/archive': '/all_blog', '/not_found': '/404', '/d/index': '/d/', '/math/index': '/math/' };
export function canonicalPath(path) {
  if (path.endsWith('.html')) path = path.slice(0, -5);
  if (/^\/blog\/[a-z0-9-]+$/.test(path)) return '/all_blog';
  return aliases[path] || path;
}
export function cleanUrl(value, basePath = '/') {
  // Only rewrite this site's links. External links keep their destinations.
  if (!value) return value;
  try {
    const url = new URL(value, new URL(basePath, 'https://chiko.cc/'));
    if (!['chiko.cc', 'www.chiko.cc'].includes(url.hostname)) return value;
    const path = url.pathname.replace(/^\/systems\//, '/').replace(/^\/legacy\/blog-images\//, '/blog-images/');
    return canonicalPath(path) + url.search + url.hash;
  } catch { return value; }
}
export function cleanHtml(html, basePath = '/') {
  return html.replace(/\b(href|src|action)=(['"])(.*?)\2/g, (_, name, quote, value) => `${name}=${quote}${cleanUrl(value, basePath)}${quote}`);
}
