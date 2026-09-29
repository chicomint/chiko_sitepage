import { MongoMemoryServer } from 'mongodb-memory-server';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const dbPath = resolve('data/mongodb');
await mkdir(dbPath, { recursive: true });
const mongo = await MongoMemoryServer.create({ instance: { port: 27017, dbPath, storageEngine: 'wiredTiger', ip: '127.0.0.1' } });
console.log('Local persistent MongoDB is ready on 127.0.0.1:27017. Keep this terminal open.');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await mongo.stop({ doCleanup: false }); process.exit(0); });
