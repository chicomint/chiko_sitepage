'use strict';

// Read-only verification: no application store initialization or schema writes.
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {MongoClient,GridFSBucket}=require('mongodb');

async function verify(db,inventory,mediaDirectory){
  const failures=[],collections=[];
  for(const expected of inventory.collections){
    const hash=createHash('sha256');let count=0;
    for await(const doc of db.collection(expected.name).find({},{raw:true}).sort({_id:1})){hash.update(doc);count++;}
    const digest=hash.digest('hex');
    if(count!==expected.count || digest!==expected.sha256)failures.push(`Collection mismatch: ${expected.name}`);
    collections.push({name:expected.name,count,matched:count===expected.count&&digest===expected.sha256});
  }
  let checkedFiles=0;
  const mediaFiles=await db.collection('fs.files').find({}).toArray();
  for(const file of mediaFiles){
    if(file.onDisk){
      const id=String(file._id);
      if(!/^[a-f0-9]{24}$/.test(id)){failures.push('Unsupported on-disk identifier.');continue;}
      const filename=path.join(mediaDirectory,id.slice(-3),id);
      try{
        const bytes=fs.readFileSync(filename);
        if(bytes.length!==Number(file.length))failures.push(`Media size mismatch: ${id}`);
      }catch{failures.push(`Missing media file: ${id}`);}
    }else{
      let bytes=0;
      try{for await(const chunk of new GridFSBucket(db).openDownloadStream(file._id))bytes+=chunk.length;
      if(bytes!==Number(file.length))failures.push(`GridFS size mismatch: ${file._id}`);}catch{failures.push(`Unreadable GridFS file: ${file._id}`);}
    }
    checkedFiles++;
  }
  const references=new Set();
  for(const name of ['threads','posts'])for await(const doc of db.collection(name).find({})){for(const file of doc.files || []){if(file.path)references.add(file.path);if(file.thumb)references.add(file.thumb);}}
  const names=new Set(mediaFiles.map(v=>v.filename));
  for(const reference of references)if(!names.has(reference))failures.push('Attachment reference has no file metadata.');
  return {verified:failures.length===0,collections,checkedFiles,attachmentReferences:references.size,failures};
}
async function main(){
  if(!process.env.MONGODB_URI || !process.env.CHIKO_DATABASE || !process.env.CHIKO_INVENTORY || !process.env.CHIKO_LEGACY_MEDIA_DIR)throw new Error('Required verification settings are missing.');
  const inventory=JSON.parse(fs.readFileSync(process.env.CHIKO_INVENTORY));
  const client=new MongoClient(process.env.MONGODB_URI);
  try{await client.connect();const result=await verify(client.db(process.env.CHIKO_DATABASE),inventory,process.env.CHIKO_LEGACY_MEDIA_DIR);console.log(JSON.stringify(result,null,2));if(!result.verified)process.exitCode=1;}finally{await client.close();}
}
if(require.main===module)main().catch(()=>{console.error('Verification failed; private connection details suppressed.');process.exitCode=1;});
module.exports={verify};
