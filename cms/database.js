import { MongoClient, GridFSBucket } from 'mongodb';
export async function connectDatabase(uri = process.env.MONGODB_URI, dbName = process.env.MONGODB_DB) {
  if (!uri) throw new Error('MONGODB_URI is required.');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 20 });
  try {
    await client.connect();
    const db = client.db(dbName || undefined);
    await Promise.all([
      db.collection('blogs').createIndex({ slug: 1 }, { unique: true }),
      db.collection('blogs').createIndex({ legacyKey: 1 }, { unique: true, sparse: true }),
      db.collection('blogs').createIndex({ published: 1, date: -1 }),
      db.collection('drawings').createIndex({ legacyKey: 1 }, { unique: true, sparse: true }),
      db.collection('drawings').createIndex({ published: 1, order: 1, date: -1 }),
      db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection('loginLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection('comments').createIndex({ blogId: 1, _id: -1 }),
      db.collection('comments').createIndex({ digest: 1 }, { unique: true, sparse: true }),
      db.collection('commentLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      db.collection('slugHistory').createIndex({ slug: 1 }, { unique: true }),
    ]);
    return { db, bucket: new GridFSBucket(db, { bucketName: 'images' }), close: () => client.close() };
  } catch (error) { await client.close(); throw error; }
}
