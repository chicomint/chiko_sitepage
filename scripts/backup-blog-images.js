import {sourceBlogs} from '../cms/migration.js';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const {posts}=await sourceBlogs();
const urls=[...new Set(posts.flatMap(p=>[...p.content.matchAll(/\[img\](https?:[^]*?)\[\/img\]/g)].map(m=>m[1])))];
await mkdir('legacy/blog-images',{recursive:true});
let previous=[];try{previous=JSON.parse(await readFile('legacy/blog-images/manifest.json','utf8'));}catch{}
const manifest=[];
for(const url of urls){
 const old=previous.find(p=>p.url===url&&p.filename);if(old){manifest.push(old);continue;}
 let response, bytes;
 for(let attempt=0;attempt<3;attempt++){try{response=await fetch(url,{signal:AbortSignal.timeout(60000)});if(response.ok){bytes=Buffer.from(await response.arrayBuffer());break;}if(response.status===404)break;}catch{} }
 if(!bytes){manifest.push({url,unavailable:true,status:response?.status||'timeout'});console.log('Existing image unavailable: '+new URL(url).hostname);continue;}
 if(bytes.length>30*1024*1024)throw Error('Legacy image too large');
 const meta=await sharp(bytes,{limitInputPixels:60000000}).metadata();if(!['png','jpeg','gif','webp'].includes(meta.format))throw Error('Invalid legacy format');
 const sha256=createHash('sha256').update(bytes).digest('hex');const filename=sha256+'.'+meta.format;
 await writeFile('legacy/blog-images/'+filename,bytes);manifest.push({url,filename,mime:'image/'+meta.format,sha256});
 await writeFile('legacy/blog-images/manifest.json',JSON.stringify(manifest,null,2));console.log('Backed up legacy image from '+new URL(url).hostname);
}
await writeFile('legacy/blog-images/manifest.json',JSON.stringify(manifest,null,2));console.log(JSON.stringify({externalImages:urls.length,backedUp:manifest.filter(x=>x.filename).length,unavailable:manifest.filter(x=>x.unavailable).length}));
