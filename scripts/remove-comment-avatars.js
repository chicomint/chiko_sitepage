import { MongoClient, GridFSBucket } from 'mongodb';
import { pathToFileURL } from 'node:url';

// Explicit, one-time cleanup. Never drop the shared images bucket or comments.
export async function removeCommentAvatars(store, apply = false) {
  const filter = { 'metadata.commentAvatar': true };
  const before = {
    avatarFields: await store.db.collection('comments').countDocuments({ avatar: { $exists: true } }),
    avatarFiles: await store.db.collection('images.files').countDocuments(filter),
    comments: await store.db.collection('comments').countDocuments(),
    blogs: await store.db.collection('blogs').countDocuments(),
    drawings: await store.db.collection('drawings').countDocuments(),
  };
  if (!apply) return { applied: false, before };
  const result = await store.db.collection('comments').updateMany({ avatar: { $exists: true } }, { $unset: { avatar: '' } });
  let filesRemoved = 0;
  for await (const file of store.db.collection('images.files').find(filter, { projection: { _id: 1 } })) {
    await store.bucket.delete(file._id);
    filesRemoved++;
  }
  const after = {
    avatarFields: await store.db.collection('comments').countDocuments({ avatar: { $exists: true } }),
    avatarFiles: await store.db.collection('images.files').countDocuments(filter),
    comments: await store.db.collection('comments').countDocuments(),
    blogs: await store.db.collection('blogs').countDocuments(),
    drawings: await store.db.collection('drawings').countDocuments(),
  };
  if (after.avatarFields || after.avatarFiles || ['comments', 'blogs', 'drawings'].some(key => after[key] < before[key])) throw new Error('Cleanup verification failed.');
  return { applied: true, fieldsRemoved: result.modifiedCount, filesRemoved, before, after };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  if (process.argv.slice(2).some(value => !['--apply', '--dry-run'].includes(value))) throw new Error('Use --dry-run or --apply.');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || undefined);
    const result = await removeCommentAvatars({ db, bucket: new GridFSBucket(db, { bucketName: 'images' }) }, process.argv.includes('--apply'));
    console.log(JSON.stringify(result));
  } finally { await client.close(); }
}
