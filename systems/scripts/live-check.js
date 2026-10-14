import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../..', import.meta.url)));
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {mkdir,writeFile} from 'node:fs/promises';
const origin=process.env.TEST_ORIGIN || 'https://chicomint-production.up.railway.app';
const mode=process.argv[2] || 'prepare';
let checks=0;
async function request(path){return fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(30000)});}
async function page(path){const response=await request(path);assert.equal(response.status,200,path);checks++;return response.text();}
await mkdir('systems/artifacts',{recursive:true});
for(const path of ['/','/blogs','/drawings','/project','/credits','/health','/math/','/all_blog'])await page(path);
for(const [from,to] of [['/index.html','/'],['/blogs.html','/blogs'],['/blogs_showcase.html','/blogs'],['/drawings.html','/drawings'],['/project.html','/project'],['/credits.html','/credits'],['/all_blog.html','/all_blog']]){const r=await request(from);assert.equal(r.status,301);assert.equal(r.headers.get('location'),to);checks++;}
for(const path of ['/:3','/admin','/admin/drawings','/admin/uploads','/api/admin/uploads','/admin.js','/cms.css']){assert.equal((await request(path)).status,404,path);checks++;}
const latest=load(await page('/blogs'));assert.equal(latest('user').length,1);
const archive=load(await page('/all_blog'));const posts=archive('user').length;assert.equal(posts,35);
assert.equal(archive('.comment-form,.blog-list').length,0);
const imageURLs=new Set();archive('img').each((_,el)=>{const url=archive(el).attr('src');if(url.startsWith('/'))imageURLs.add(url);});
const gallery=load(await page('/drawings'));gallery('#drawing-gallery img').each((_,el)=>imageURLs.add(gallery(el).attr('src')));assert.ok(gallery('#drawing-gallery img').length>=8);
for(const url of imageURLs){const r=await request(url);assert.equal(r.status,200,url);assert.ok((await r.arrayBuffer()).byteLength>0);checks++;}
for(const path of ['/.env','/cms/auth.js','/server.js','/package.json','/legacy/all_blog'])assert.equal((await request(path)).status,404);
if(mode==='final'){ assert.equal(posts,35); assert.equal(gallery('#drawing-gallery img').length,8); }
const result={origin,mode,checks,posts,drawings:gallery('#drawing-gallery img').length,storedImagesChecked:imageURLs.size,passed:true};await writeFile('systems/artifacts/live-'+mode+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
