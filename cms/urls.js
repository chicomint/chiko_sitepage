const aliases = { '/index': '/', '/blogs_showcase': '/blogs', '/all_blog': '/blogs/archive', '/not_found': '/404', '/d/index': '/d/', '/math/index': '/math/' };
export function canonicalPath(path) {
  if (path.endsWith('.html')) path = path.slice(0, -5);
  return aliases[path] || path;
}
export function cleanUrl(value) {
  // Only rewrite this site's links. External links keep their destinations.
  try {
    const url = new URL(value, 'https://chiko.cc/');
    if (!['chiko.cc', 'www.chiko.cc'].includes(url.hostname)) return value;
    return canonicalPath(url.pathname) + url.search + url.hash;
  } catch { return value; }
}
export function cleanHtml(html) {
  return html.replace(/\b(href|action)=(['"])(.*?)\2/g, (_, name, quote, value) => `${name}=${quote}${cleanUrl(value)}${quote}`);
}
