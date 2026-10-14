import { ObjectId } from 'mongodb';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { problem, redirect } from '../site/http.js';

const live = { deletedAt: { $exists: false } };
const visible = { ...live, published: true };

export async function storeImage(store, image, metadata = {}) {
  const stream = store.bucket.openUploadStream(`${randomUUID()}.${image.extension}`, { metadata: { uploadedAt: new Date(), contentType: image.mime, size: image.bytes.length, ...metadata, mime: image.mime, sha256: createHash('sha256').update(image.bytes).digest('hex') } });
  try { await pipeline(Readable.from(image.bytes), stream); }
  catch (error) { await stream.abort().catch(() => {}); throw error; }
  return { _id: stream.id, url: `/uploads/${stream.id}` };
}

export function createDrawingStorage(store, { maxDrawings = 1000 } = {}) {
  if (!Number.isSafeInteger(maxDrawings) || maxDrawings <= 0) throw new Error('Invalid drawing storage limit.');
  const drawings = store.db.collection('drawings');
  return {
    async health() { await store.db.command({ ping: 1 }); },
    async list() {
      return drawings.find(visible, { projection: { title: 1, image: 1, thumbnail: 1, description: 1, date: 1, order: 1, createdAt: 1 } })
        .sort({ order: 1, date: -1, createdAt: -1 }).limit(1000).toArray();
    },
    async save(bytes) {
      if (await drawings.countDocuments(live) >= maxDrawings) throw problem(507, 'Drawing storage is full.');
      const file = await storeImage(store, { bytes, mime: 'image/png', extension: 'png' }, { visitorDrawing: true, originalName: 'Visitor drawing' });
      const record = { title: 'Visitor drawing', image: file.url, thumbnail: '', description: '', date: new Date().toISOString().slice(0, 10), order: 0, published: true, createdAt: new Date(), updatedAt: new Date() };
      const result = await drawings.insertOne(record);
      return { ...record, _id: result.insertedId };
    },
    async legacy(req, res, filename) {
      const drawing = await drawings.findOne({ legacyFilename: filename, ...visible });
      if (!drawing) throw problem(404, 'Drawing not found.');
      return redirect(res, drawing.image, 301);
    },
    async serveImage(req, res, value) {
      if (!/^[a-f0-9]{24}$/.test(value)) throw problem(404, 'Image not found.');
      const url = `/uploads/${value}`;
      if (!await drawings.findOne({ ...visible, $or: [{ image: url }, { thumbnail: url }] })) throw problem(404, 'Image not found.');
      const _id = ObjectId.createFromHexString(value);
      const file = await store.db.collection('images.files').findOne({ _id });
      if (!file || file.metadata?.commentAvatar) throw problem(404, 'Image not found.');
      res.writeHead(200, { 'Content-Type': file.metadata.mime, 'Content-Length': file.length, 'Cache-Control': 'public, max-age=300', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = store.bucket.openDownloadStream(_id);
      res.on('close', () => stream.destroy());
      await pipeline(stream, res);
    },
  };
}
