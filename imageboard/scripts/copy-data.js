'use strict';

// Copies BSON losslessly into a fresh staging database. No source writes,
// updates, replacement operations, seed records or destructive cleanup.
const {BSON}=require('mongodb');
const {createHash}=require('node:crypto');
async function exportCopy(db){
  const collections=[];
  for(const info of await db.listCollections().toArray()){
    if(info.type!=='collection')throw new Error('Views require an explicit migration plan.');
    const documents=[];
    for await(const doc of db.collection(info.name).find({},{raw:true}).sort({_id:1}))documents.push(doc.toString('base64'));
    collections.push({name:info.name,documents,indexes:await db.collection(info.name).indexes()});
  }
  return {format:'chikochan-bson-copy-v1',sourceDatabase:db.databaseName,at:new Date().toISOString(),collections};
}
async function importCopy(db,bundle){
  if(!/^chiko_staging_[a-z0-9_]+$/.test(db.databaseName)||db.databaseName===bundle.sourceDatabase)throw new Error('Only a separately named staging database may be imported.');
  if(bundle.format!=='chikochan-bson-copy-v1'||!Array.isArray(bundle.collections))throw new Error('Unsupported copy format.');
  if((await db.listCollections().toArray()).length)throw new Error('The target must be empty. Existing data will never be overwritten.');
  let total=0;
  for(const {name,documents,indexes} of bundle.collections){
    if(typeof name!=='string'||name.startsWith('system.')||!Array.isArray(documents))throw new Error('Unsupported source collection.');
    const col=await db.createCollection(name);
    for(let offset=0;offset<documents.length;offset+=100){
      await col.insertMany(documents.slice(offset,offset+100).map(encoded=>BSON.deserialize(Buffer.from(encoded,'base64'),{promoteValues:false})),{ordered:true});
    }
    for(const index of indexes){
      if(index.name==='_id_'||index.expireAfterSeconds!==undefined)continue;
      const {key,v,ns,...options}=index;await col.createIndex(key,options);
    }
    const expected=createHash('sha256'),actual=createHash('sha256');
    for(const encoded of documents)expected.update(Buffer.from(encoded,'base64'));
    for await(const doc of col.find({},{raw:true}).sort({_id:1}))actual.update(doc);
    if(expected.digest('hex')!==actual.digest('hex'))throw new Error('The restored BSON does not match the source.');
    total+=documents.length;
  }
  return {collections:bundle.collections.length,documents:total,verified:true};
}
module.exports={exportCopy,importCopy};
