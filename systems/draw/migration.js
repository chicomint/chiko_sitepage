import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { storeImage } from './storage.js';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = resolve(new URL('../../', import.meta.url).pathname);
export async function migrate(store, { drawingsDirectory = process.env.LEGACY_DRAWINGS_DIRECTORY || process.env.DRAWINGS_DIRECTORY || join(root, 'systems/draw/legacy') } = {}) {
  // Import drawings without altering the static blog or existing database records.
  const locks = store.db.collection('migrationLocks');
  const key = 'legacy-drawings-v1';
  try { await locks.insertOne({ _id: key, expiresAt: new Date(Date.now() + 15 * 60000) }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    const previous = await locks.findOneAndUpdate({ _id: key, expiresAt: { $lt: new Date() } }, { $set: { expiresAt: new Date(Date.now() + 15 * 60000) } }, { returnDocument: 'after' });
    if (!previous) throw new Error('Another drawing migration is running; retry when it finishes.');
  }
  try {
    let entries;
    try { entries = await readdir(drawingsDirectory, { withFileTypes: true }); }
    catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
    const filenames = entries.filter(f => f.isFile() && /^\d{13}-[a-f0-9]{32}\.png$/.test(f.name)).map(f => f.name).sort();
    for (const filename of filenames) {
      const legacyKey = 'drawing:' + filename;
      const filePath = join(drawingsDirectory, filename);
      if ((await lstat(filePath)).isSymbolicLink()) throw new Error('Invalid legacy drawing.');
      const bytes = await readFile(filePath);
      let saved = await store.db.collection('drawings').findOne({ legacyKey });
      if (!saved) {
        const file = await storeImage(store, { bytes, mime: 'image/png', extension: 'png' }, { originalName: filename, visitorDrawing: true, legacyUrl: '/drawings/' + filename });
        const time = new Date(Number(filename.slice(0, 13)));
        await store.db.collection('drawings').updateOne({ legacyKey }, { $setOnInsert: { title: 'Visitor drawing', image: file.url, thumbnail: '', description: '', date: time.toISOString().slice(0, 10), order: 0, published: true, createdAt: time, updatedAt: time, legacyKey, legacyFilename: filename, legacyImage: file.url, legacyHash: sha(bytes) } }, { upsert: true });
        saved = await store.db.collection('drawings').findOne({ legacyKey });
      }
      if (saved.legacyHash !== sha(bytes)) throw new Error('Drawing source has changed; migration stopped.');
      if (!saved.legacyImage) await store.db.collection('drawings').updateOne({ _id: saved._id }, { $set: { legacyImage: saved.image } });
      const imageId = (saved.legacyImage || saved.image).split('/').pop();
      const file = await store.db.collection('images.files').findOne({ _id: ObjectId.createFromHexString(imageId) });
      if (!file || file.metadata.sha256 !== sha(bytes)) throw new Error('Drawing storage verification failed.');
    }
    const result = { drawings: filenames.length, verifiedAt: new Date() };
    await store.db.collection('migrations').updateOne({ _id: key }, { $set: result }, { upsert: true });
    return result;
  } finally { await locks.deleteOne({ _id: key }); }
}
