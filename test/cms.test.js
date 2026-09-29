import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import { connectDatabase } from '../cms/database.js';
import { migrate, sourceBlogs } from '../cms/migration.js';
import { createCMS } from '../cms/index.js';
import { createPresenceServer } from '../server.js';
import { renderBBCode, safeUrl } from '../cms/bbcode.js';
import { load } from 'cheerio';

test('BBCode rendering escapes HTML, validates URLs, and supports all editor tags', () => {
 const html = renderBBCode('[b]bold[/b][i]italics[/i][u]u[/u][s]s[/s][url=https://example.com]link[/url][quote]quote[/quote][code]<script>alert(1)</script>[/code][list][*]one[*]two[/list][center]center[/center][color=red]red[/color][size=24]size[/size]');
 for(const tag of ['strong','em','u','s','a','blockquote','pre','code','ul','li','div','span']) assert.ok(html.includes('<'+tag));
 const attack = renderBBCode('<script>alert(1)</script><img src=x onerror=alert(1)>[url=javascript:alert(1)]x[/url][img]data:image/svg+xml,x[/img][color=red;position:fixed]x[/color][img]//evil.test/a[/img]');
 assert.doesNotMatch(attack, /<script|<[^>]+onerror=|href="javascript|src="(?:data|\/\/)|style=".*position/);
 assert.equal(safeUrl('javascript:alert(1)'), ''); assert.equal(safeUrl('/\\evil.test'), '');
 assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
 assert.doesNotThrow(()=>renderBBCode('[list]'.repeat(3000)+'x'+'[/list]'.repeat(3000)));
});

test('CMS integration: migration, CRUD, sessions, uploads, redirects and persistence', {timeout:120000}, async t => {
 const dbName = 'cms_test_' + randomBytes(8).toString('hex');
 const store = await connectDatabase('mongodb://127.0.0.1:27017/' + dbName);
 const temporary = await mkdtemp(join(tmpdir(),'cms-test-'));
 await copyFile(new URL('../chicomint-stats.csv', import.meta.url), join(temporary,'stats.csv'));
 const env = { ADMIN_USERNAME:'test-admin', ADMIN_PASSWORD:'test-secret-password', SESSION_SECRET:randomBytes(32).toString('hex'), NODE_ENV:'development' };
 let app, origin;
 async function start() {
   app = createPresenceServer({ cms:createCMS(store,env), statsCsvPath:join(temporary,'stats.csv'), drawingsDirectory:join(temporary,'drawings') });
   await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve)); origin='http://127.0.0.1:'+app.server.address().port;
 }
 let cookie='', csrf='';
 async function request(path, options={}) { return fetch(origin+path,{redirect:'manual',...options,headers:{...(cookie?{cookie}:{}),...options.headers}}); }
 async function login() {
   let r=await request('/:3'); cookie=r.headers.get('set-cookie')?.split(';')[0] || cookie; csrf=(await r.text()).match(/name="csrf" value="([^"]+)"/)[1];
   r=await post('/:3',{username:env.ADMIN_USERNAME,password:env.ADMIN_PASSWORD}); assert.equal(r.status,303); cookie=r.headers.get('set-cookie').split(';')[0];
   r=await request('/admin'); csrf=(await r.text()).match(/name="csrf" value="([^"]+)"/)[1];
 }
 const post=(path,data={})=>request(path,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',Origin:origin},body:new URLSearchParams({csrf,...data})});
 try {
   const first=await migrate(store,{drawingsDirectory:join(temporary,'drawings')}); assert.equal(first.blogs,35);
   await migrate(store,{drawingsDirectory:join(temporary,'drawings')}); assert.equal(await store.db.collection('blogs').countDocuments(),35);
   const {posts}=await sourceBlogs();
   for(const source of posts) {
     const row=await store.db.collection('blogs').findOne({legacyKey:source.legacyKey});
     assert.equal(row.title,source.title); assert.equal(row.date,source.date); assert.equal(row.legacy.html,source.legacy.html);
     assert.ok(renderBBCode(row.content));
   }
   await start();
   for(const path of ['/','/blogs','/blogs/archive','/project','/credits','/drawings','/math/','/d/','/:3','/health']) assert.equal((await request(path)).status,200,path);
   for(const [old,canonical] of [['/index.html','/'],['/blogs.html','/blogs'],['/blogs_showcase.html','/blogs'],['/all_blog.html','/blogs/archive'],['/drawings.html','/drawings'],['/project.html','/project'],['/credits.html','/credits'],['/math/index.html','/math/']]) { const r=await request(old); assert.equal(r.status,301); assert.equal(r.headers.get('location'),canonical); }
   assert.equal((await request('/admin')).headers.get('location'),'/:3');
   assert.equal((await post('/api/admin/uploads')).status,401);
   assert.equal((await request('/blog/missing')).status,404);
   let r=await request('/blogs'), html=await r.text(); assert.equal((html.match(/class="blog-title"/g)||[]).length,35); assert.ok(html.indexOf('09/25/2026')<html.indexOf('04/02/2026'));
   assert.doesNotMatch(html,/href="[^"\s]*\.html/);
   for(const row of await store.db.collection('blogs').find().toArray()) assert.equal((await request('/blog/'+row.slug)).status,200);
   for(const url of await store.db.collection('legacyAssets').find().toArray()) { const imageResponse = await request(url.url); assert.equal(imageResponse.status,200); await imageResponse.arrayBuffer(); }
   r=await request('/:3'); cookie=r.headers.get('set-cookie')?.split(';')[0] || cookie; csrf=(await r.text()).match(/name="csrf" value="([^"]+)"/)[1];
   assert.match(r.headers.get('set-cookie'),/HttpOnly/); assert.match(r.headers.get('set-cookie'),/SameSite=Strict/);
   assert.equal((await post('/:3',{username:env.ADMIN_USERNAME,password:'incorrect'})).status,401);
   await login();
   assert.equal((await post('/admin/blogs/new',{csrf:'wrong'})).status,403);
   const draft={title:'Test CMS blog',slug:'test-cms-blog',date:'2026-09-28',content:'[b]Hello[/b] <script>alert(1)</script>',coverImage:''};
   assert.equal((await post('/admin/blogs/new',{...draft,date:'2026-02-31'})).status,400);
   assert.equal((await post('/admin/blogs/new',draft)).status,303);
   let blog=await store.db.collection('blogs').findOne({slug:draft.slug}); assert.ok(blog); assert.equal((await request('/blog/'+draft.slug)).status,404);
   assert.equal((await post('/api/admin/preview',draft)).status,200);
   const bytes=await sharp({create:{width:30,height:30,channels:3,background:'red'}}).png().toBuffer();
   const upload=(filename,mime,data)=>request('/api/admin/uploads',{method:'POST',headers:{'Content-Type':mime,'X-Filename':encodeURIComponent(filename),'X-CSRF-Token':csrf,Origin:origin},body:data});
   assert.equal((await upload('evil.svg','image/svg+xml',Buffer.from('<svg></svg>'))).status,415);
   assert.equal((await upload('photo.jpg','image/jpeg',bytes)).status,400);
   r=await upload('photo.png','image/png',bytes); assert.equal(r.status,201); const image=await r.json();
   draft.content+='\n[img]'+image.url+'[/img]';
   assert.equal((await post('/admin/blogs/'+blog._id,{...draft,published:'on'})).status,303);
   r=await request('/blog/'+draft.slug); html=await r.text(); assert.equal(r.status,200); assert.match(html,/<strong>Hello<\/strong>/); assert.doesNotMatch(html,/<script>alert/); assert.ok(html.includes(image.url));
   assert.ok((await (await request('/blogs')).text()).includes('Test CMS blog'));
   assert.equal((await post('/admin/blogs/'+blog._id,{...draft,slug:'edited-blog',published:'on'})).status,303);
   r=await request('/blog/'+draft.slug);assert.equal(r.status,301);assert.equal(r.headers.get('location'),'/blog/edited-blog');
   assert.equal((await post('/admin/blogs/'+blog._id,{...draft,slug:'edited-blog'})).status,303);assert.equal((await request('/blog/edited-blog')).status,404);
   const drawing={title:'Test drawing',date:'2026-09-28',image:image.url,description:'Caption <script>x</script>',order:'2',published:'on'};
   assert.equal((await post('/admin/drawings/new',drawing)).status,303);const row=await store.db.collection('drawings').findOne({title:drawing.title});
   assert.ok((await (await request('/drawings')).text()).includes('Test drawing'));
   assert.equal((await post('/admin/drawings/'+row._id,{...drawing,title:'Edited drawing',order:'1'})).status,303);
   assert.equal((await post('/admin/drawings/'+row._id+'/delete',{confirm:'no'})).status,400);
   assert.equal((await post('/admin/drawings/'+row._id+'/delete',{confirm:'delete'})).status,303);
   assert.equal((await post('/admin/blogs/'+blog._id+'/delete',{confirm:'delete'})).status,303);
   await migrate(store,{drawingsDirectory:join(temporary,'drawings')});assert.equal(await store.db.collection('blogs').countDocuments({legacyKey:{$exists:true}}),35);
   await app.close(); app = null; await start();
   { const imageResponse = await request(image.url); assert.equal(imageResponse.status,200); await imageResponse.arrayBuffer(); }assert.equal((await request('/admin')).status,200);
   for(const path of ['/.env','/server.js','/cms/auth.js','/package.json','/scripts/migrate.js','/backups/pre-cms/manifest.json']) assert.equal((await request(path)).status,404);
   assert.equal((await post('/admin/logout')).status,303); assert.equal((await request('/admin')).headers.get('location'),'/:3');
   cookie=''; await login(); await store.db.collection('sessions').updateMany({},{$set:{expiresAt:new Date(0)}}); assert.equal((await request('/admin')).headers.get('location'),'/:3');
   // Verify secure cookies and hash authentication against the same server API.
   const secureAuth=(await import('../cms/auth.js')).createAuth(store.db,{...env,ADMIN_PASSWORD_HASH:await bcrypt.hash(env.ADMIN_PASSWORD,12),NODE_ENV:'production',SITE_ORIGIN:'https://test.example'});
   let header;const fake={setHeader:(_,v)=>header=v};await secureAuth.issue(fake,true);assert.match(header,/__Host-/);assert.match(header,/; Secure/);
   for(let i=0;i<12;i++){try{await secureAuth.limit({socket:{remoteAddress:'192.0.2.1'},headers:{}});}catch(error){assert.equal(error.status,429);}}
   assert.equal(await store.db.collection('blogs').countDocuments({legacyKey:{$exists:true}}),35);
 } finally { if(app) await app.close(); await store.db.dropDatabase(); await store.close(); await rm(temporary,{recursive:true,force:true}); }
});
