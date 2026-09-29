import {connectDatabase} from '../cms/database.js';
import {sourceBlogs} from '../cms/migration.js';
import {renderBBCode} from '../cms/bbcode.js';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
let store;
try {
 store=await connectDatabase();const {posts}=await sourceBlogs();let checked=0;
 for(const source of posts){const row=await store.db.collection('blogs').findOne({legacyKey:source.legacyKey});if(!row||row.legacy.html!==source.legacy.html)throw Error('Missing source post');if(!renderBBCode(row.content))throw Error('Empty rendered post');checked++;}
 let images=0;for(const file of await store.db.collection('images.files').find().toArray()) {const hash=createHash('sha256');for await(const chunk of store.bucket.openDownloadStream(file._id))hash.update(chunk);if(hash.digest('hex')!==file.metadata.sha256)throw Error('Image checksum mismatch');images++;}
 const drawings=await store.db.collection('drawings').countDocuments({legacyKey:{$exists:true}});
 console.log(JSON.stringify({verified:true,blogs:checked,drawings,images,gridFSChecksums:'passed'}));
} catch {console.error('Migration verification failed; source copies have been retained.');process.exitCode=1;} finally{await store?.close();}
