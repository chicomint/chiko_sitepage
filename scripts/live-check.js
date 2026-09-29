import assert from 'node:assert/strict';
import {load} from 'cheerio';
import sharp from 'sharp';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin=process.env.TEST_ORIGIN || 'https://chicomint-production.up.railway.app';
const mode=process.argv[2] || 'prepare';
let cookie='',csrf='';let checks=0;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function request(path,options={}){const r=await fetch(origin+path,{redirect:'manual',...options,headers:{...(cookie?{cookie}:{}),...options.headers},signal:AbortSignal.timeout(60000)});return r;}
async function page(path){const r=await request(path);assert.equal(r.status,200,path);checks++;return r.text();}
const post=(path,data={})=>request(path,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',Origin:origin},body:new URLSearchParams({csrf,...data})});
async function login(){let r=await request('/:3');assert.equal(r.status,200);cookie=r.headers.get('set-cookie')?.split(';')[0]||cookie;assert.match(r.headers.get('set-cookie')||'',/Secure/);assert.match(r.headers.get('set-cookie')||'',/HttpOnly/);assert.match(r.headers.get('set-cookie')||'',/SameSite=Strict/);csrf=load(await r.text())('[name=csrf]').val();if(mode==='prepare')assert.equal((await post('/:3',{username:process.env.ADMIN_USERNAME,password:'deliberately-incorrect'})).status,401);r=await post('/:3',{username:process.env.ADMIN_USERNAME,password:process.env.ADMIN_PASSWORD});assert.equal(r.status,303);cookie=r.headers.get('set-cookie').split(';')[0];csrf=load(await page('/admin'))('[name=csrf]').val();checks+=4;}
await mkdir('artifacts',{recursive:true});
for(const path of ['/','/blogs','/drawings','/project','/credits','/health','/math/','/d/'])await page(path);
for(const [from,to] of [['/index.html','/'],['/blogs.html','/blogs'],['/blogs_showcase.html','/blogs'],['/drawings.html','/drawings'],['/project.html','/project'],['/credits.html','/credits'],['/all_blog.html','/blogs/archive']]){const r=await request(from);assert.equal(r.status,301);assert.equal(r.headers.get('location'),to);checks++;}
assert.equal((await request('/admin')).headers.get('location'),'/:3');assert.equal((await post('/api/admin/uploads')).status,401);
const list=load(await page('/blogs'));const links=list('.blog-list a').map((_,el)=>list(el).attr('href')).get();assert.ok(links.length>=35);
const imageURLs=new Set();for(const link of links){const html=await page(link);const $=load(html);$('.blog-body img').each((_,el)=>{const url=$(el).attr('src');if(url.startsWith('/uploads/'))imageURLs.add(url);});assert.equal($('a[href$=".html"]').length,0);}
const gallery=load(await page('/drawings'));gallery('#drawing-gallery img').each((_,el)=>imageURLs.add(gallery(el).attr('src')));assert.ok(gallery('#drawing-gallery img').length>=8);
for(const url of imageURLs){const r=await request(url);assert.equal(r.status,200,url);assert.ok((await r.arrayBuffer()).byteLength>0);checks++;}
await login();
let record;
if(mode==='prepare'){
const stamp=Date.now();const title='CMS deployment verification '+stamp;const slug='cms-verification-'+stamp;
let r=await post('/admin/blogs/new',{title,slug,date:'2026-09-29',content:'[b]Production verification[/b]\n<script>alert(1)</script>'});assert.equal(r.status,303);assert.equal((await request('/blog/'+slug)).status,404);
let $=load(await page('/admin/blogs'));const edit=$('.cms-row').filter((_,el)=>$(el).text().includes(title)).find('a').first().attr('href');assert.ok(edit);
const bytes=await sharp({create:{width:32,height:32,channels:3,background:'#7fb82a'}}).png().toBuffer();
r=await request('/api/admin/uploads',{method:'POST',headers:{'Content-Type':'image/png','X-Filename':'cms-verification.png','X-CSRF-Token':csrf,Origin:origin},body:bytes});assert.equal(r.status,201);const image=await r.json();
const body={title,slug,date:'2026-09-29',content:'[b]Production verification[/b]\n[img]'+image.url+'[/img]\n<script>alert(1)</script>',published:'on'};
assert.equal((await post(edit,body)).status,303);let html=await page('/blog/'+slug);assert.match(html,/<strong>Production verification<\/strong>/);assert.doesNotMatch(html,/<script>alert/);
assert.equal((await post('/api/admin/preview',body)).status,200);
assert.equal((await post(edit,{...body,published:'false'})).status,303);assert.equal((await request('/blog/'+slug)).status,404);assert.equal((await post(edit,body)).status,303);
assert.equal((await post('/admin/drawings/new',{title,date:'2026-09-29',image:image.url,description:'Temporary deployment check',order:'-1',published:'on'})).status,303);
$=load(await page('/admin/drawings'));const drawing=$('.cms-row').filter((_,el)=>$(el).text().includes(title)).find('a').first().attr('href');assert.ok(drawing);
assert.equal((await post(drawing,{title,date:'2026-09-29',image:image.url,description:'Edited temporary deployment check',order:'1',published:'on'})).status,303);
record={origin,title,slug,blog:edit,drawing,image:image.url,imageHash:hash(Buffer.from(await (await request(image.url)).arrayBuffer()))};await writeFile('artifacts/live-probe.json',JSON.stringify(record,null,2));checks+=12;
}else if(mode==='verify'||mode==='cleanup'){
record=JSON.parse(await readFile('artifacts/live-probe.json','utf8'));
assert.equal(hash(Buffer.from(await (await request(record.image)).arrayBuffer())),record.imageHash);await page('/blog/'+record.slug);checks++;
if(mode==='cleanup'){
for(const path of [record.blog,record.drawing]){await page(path+'/delete');assert.equal((await post(path+'/delete',{confirm:'delete'})).status,303);checks++;}
assert.equal((await request('/blog/'+record.slug)).status,404);
assert.equal((await post('/admin/uploads/'+record.image.split('/').pop()+'/delete',{confirm:'delete'})).status,303);
}
}
assert.equal((await post('/admin/logout')).status,303);assert.equal((await request('/admin')).headers.get('location'),'/:3');checks++;
for(const path of ['/.env','/cms/auth.js','/server.js','/package.json','/legacy/all_blog'])assert.equal((await request(path)).status,404);
if(mode==='final'){ assert.equal(links.length,35); assert.equal(gallery('#drawing-gallery img').length,8); assert.equal(imageURLs.size,24); }
const result={origin,mode,checks,posts:links.length,drawings:gallery('#drawing-gallery img').length,storedImagesChecked:imageURLs.size,passed:true};await writeFile('artifacts/live-'+mode+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
