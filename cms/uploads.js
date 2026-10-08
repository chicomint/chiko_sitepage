import sharp from 'sharp';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extname } from 'node:path';
import { problem } from './http.js';
import { id, visible } from './models.js';
const formats = { '.jpg': ['image/jpeg', 'jpeg'], '.jpeg': ['image/jpeg', 'jpeg'], '.png': ['image/png', 'png'], '.webp': ['image/webp', 'webp'], '.gif': ['image/gif', 'gif'] };
export const MAX_UPLOAD = 10 * 1024 * 1024;
let processing = 0;
export async function validateImage(buffer, filename, mime) {
  const format = formats[extname(filename || '').toLowerCase()];
  if (!format || mime !== format[0]) throw problem(415, 'Upload a JPEG, PNG, WebP, or GIF with a matching extension and MIME type.');
  if (buffer.length > MAX_UPLOAD) throw problem(413, 'Images must be at most 10 MiB.');
  if (processing >= 3) throw problem(503, 'Image processing is busy. Try again shortly.');
  processing++;
  try {
    const image = sharp(buffer, { animated: true, limitInputPixels: 40000000, failOn: 'warning' });
    const meta = await image.metadata();
    if (meta.format !== format[1] || (meta.pages || 1) > 200 || meta.width * meta.height > 40000000) throw new Error();
    // Decode and re-encode; strip metadata and any appended executable/polyglot payload.
    const bytes = await image.rotate().toFormat(format[1]).toBuffer();
    if (bytes.length > MAX_UPLOAD) throw problem(413, 'Processed image exceeds 10 MiB.');
    return { bytes, mime: format[0], extension: format[1] === 'jpeg' ? 'jpg' : format[1] };
  } catch (error) { if (error.status) throw error; throw problem(400, 'Invalid or oversized image.'); }
  finally { processing--; }
}
export async function storeImage(store, image, metadata = {}) {
  const stream = store.bucket.openUploadStream(`${randomUUID()}.${image.extension}`, { metadata: { uploadedAt: new Date(), contentType: image.mime, size: image.bytes.length, ...metadata, mime: image.mime, sha256: createHash('sha256').update(image.bytes).digest('hex') } });
  try { await pipeline(Readable.from(image.bytes), stream); }
  catch (error) { await stream.abort().catch(() => {}); throw error; }
  return { _id: stream.id, url: `/uploads/${stream.id}` };
}
export async function serveImage(store, req, res, value) {
  const _id = id(value);
  const file = await store.db.collection('images.files').findOne({ _id });
  if (!file) throw problem(404, 'Image not found.');
  if (file.metadata?.visitorDrawing) {
    if (!await store.db.collection('drawings').findOne({ image: `/uploads/${_id}`, ...visible })) throw problem(404, 'Image not found.');
  }
  if (file.metadata?.commentAvatar) throw problem(404, 'Image not found.');
  res.writeHead(200, { 'Content-Type': file.metadata.mime, 'Content-Length': file.length, 'Cache-Control': 'public, max-age=300', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = store.bucket.openDownloadStream(_id);
  res.on('close', () => stream.destroy());
  await pipeline(stream, res);
}
