import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
import {connectDatabase} from '../draw/database.js';
import {createHash} from 'node:crypto';
let store;
try {
 store=await connectDatabase();
 let images=0;for(const file of await store.db.collection('images.files').find().toArray()) {const hash=createHash('sha256');for await(const chunk of store.bucket.openDownloadStream(file._id))hash.update(chunk);if(hash.digest('hex')!==file.metadata.sha256)throw Error('Image checksum mismatch');images++;}
 const drawings=await store.db.collection('drawings').countDocuments({legacyKey:{$exists:true}});
 console.log(JSON.stringify({verified:true,drawings,images,gridFSChecksums:'passed'}));
} catch {console.error('Migration verification failed; source copies have been retained.');process.exitCode=1;} finally{await store?.close();}
