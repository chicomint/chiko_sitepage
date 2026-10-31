import { MongoClient, GridFSBucket } from 'mongodb';
export async function connectDatabase(uri = process.env.MONGODB_URI, dbName = process.env.MONGODB_DB) {
  if (!uri) throw new Error('MONGODB_URI is required.');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 20 });
  try {
    await client.connect();
    const db = client.db(dbName || undefined);
    await Promise.all([
      db.collection('drawings').createIndex({ legacyKey: 1 }, { unique: true, sparse: true }),
      db.collection('drawings').createIndex({ published: 1, order: 1, date: -1 }),
    ]);
    return { db, bucket: new GridFSBucket(db, { bucketName: 'images' }), close: () => client.close() };
  } catch (error) { await client.close(); throw error; }
}
