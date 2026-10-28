'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {MongoClient,ObjectId,BSON}=require('mongodb');
const {CompatibleStore}=require('../compat/store');
const {createCompatibleApp}=require('../compat/application');
const {passwordMatches,passwordHash}=require('../compat/auth');
const {MongoStore}=require('../lib/mongo-store');
const {loadConfig}=require('../config');

test('source password verification preserves PBKDF2 versions, whitespace and unknown credentials',async()=>{
  for(const [passwordMethod,iterations] of [['pbkdf2',4096],['pbkdf2V2',16384]]){
    const password=' spaces are significant ',passwordSalt='fixture-salt';
    const user={passwordMethod,passwordSalt,password:crypto.pbkdf2Sync(password,passwordSalt,iterations,256,'sha512').toString('base64')};
    const original=structuredClone(user);
    assert.equal(await passwordMatches(user,password),true);
    assert.equal(await passwordMatches(user,password.trim()),false);
    assert.deepEqual(user,original);
  }
  assert.equal(await passwordMatches({password:'unchanged'},'anything'),false);
  assert.equal(await passwordMatches({passwordMethod:'toString'},'anything'),false);
  const nativeSalt=crypto.randomBytes(16),nativePassword='original native password';
  const nativeHash=`scrypt$${nativeSalt.toString('base64url')}$${crypto.scryptSync(nativePassword,nativeSalt,32).toString('base64url')}`;
  assert.equal(await passwordMatches({chikoLegacyScryptHash:nativeHash},nativePassword),true);
  assert.equal(await passwordMatches({chikoLegacyScryptHash:nativeHash},'wrong'),false);
  const encoded=await passwordHash('test password');
  assert.equal(await passwordMatches({chikoPasswordHash:encoded},'test password'),true);
  assert.equal(await passwordMatches({chikoPasswordHash:encoded},'wrong'),false);
});

test('compatible HTTP application preserves board-scoped IDs and exercises posting, media and scoped moderation', {skip:!process.env.CHIKO_TEST_MONGO_URI},async t=>{
  const uri=process.env.CHIKO_TEST_MONGO_URI;
  if(!/^mongodb:\/\/(?:127\.0\.0\.1|localhost):\d+\/?$/.test(uri))throw new Error('Integration tests require an explicit local MongoDB endpoint without credentials.');
  const client=new MongoClient(uri);await client.connect();
  const db=client.db('chiko_test_'+crypto.randomBytes(10).toString('hex'));
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'chiko-compatible-'));
  t.after(async()=>{await client.close();await fs.rm(folder,{recursive:true,force:true});});
  const passwordSalt='source-salt',password='correct staff password';
  const root={_id:new ObjectId(),login:'root',globalRole:0,passwordMethod:'pbkdf2V2',passwordSalt,password:crypto.pbkdf2Sync(password,passwordSalt,16384,256,'sha512').toString('base64')};
  await db.collection('users').insertMany([root,{_id:new ObjectId(),login:'boardmod',globalRole:4,chikoPasswordHash:await passwordHash(password)},{...root,_id:new ObjectId(),login:'administrator',globalRole:1}]);
  await db.collection('boards').insertMany([{boardUri:'a',boardName:'A',boardDescription:'Original A',lastPostId:5,owner:'root',volunteers:['boardmod'],settings:[],unknown:{preserve:true}},{boardUri:'b',boardName:'B',lastPostId:5,owner:'root',volunteers:[],settings:[]}]);
  await db.collection('threads').insertMany(['a','b'].map(boardUri=>({boardUri,threadId:1,message:boardUri+' original',creation:new Date(),lastBump:new Date(),files:[],unknown:'keep',_chikoMigration:{oldId:boardUri==='a'?100:200}})));
  await db.collection('posts').insertMany(['a','b'].map(boardUri=>({boardUri,threadId:1,postId:2,message:'>>1 original reply '+boardUri,creation:new Date(),files:[],_chikoMigration:{oldId:boardUri==='a'?101:201}})));
  await db.collection('chikoIdMap').insertOne({oldId:100,oldThreadId:100,boardUri:'a',threadId:1,postId:1});
  await db.collection('witnessedReleases').insertOne({version:16,active:true});
  const original=[];for(const name of ['users','boards','threads','posts','witnessedReleases'])for await(const doc of db.collection(name).find({})){original.push({name,id:doc._id,bytes:BSON.serialize(doc)});}
  const store=new CompatibleStore({client,database:db.databaseName});await store.ready;
  const app=await createCompatibleApp({store,origin:'http://localhost',secret:'s'.repeat(40),abuseSecret:'a'.repeat(40),readonly:false,mediaDirectory:folder,legacyDirectory:folder,trustProxy:'loopback'});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  function browser(){const cookies=new Map();return {cookies,async request(url,options={}){const response=await fetch(base+url,{...options,redirect:'manual',headers:{...options.headers,Cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')}});for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';');const at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}return response;},async form(url,fields){return this.request(url,{method:'POST',body:new URLSearchParams({csrf:cookies.get('chiko_csrf'),...fields})});}};}
  const guest=browser(),admin=browser(),mod=browser();
  const oldUrl=await guest.request('/a/thread/100');assert.equal(oldUrl.status,301);assert.equal(oldUrl.headers.get('location'),'/a/res/1.html','do not overwrite an incoming reply fragment');
  const originalHtml=await (await guest.request('/a/res/1.html')).text();assert.match(originalHtml,/id="p101"/);assert.match(originalHtml,/id="m101"/);
  for(const b of ['a','b']){const response=await guest.request('/api/'+b+'/thread/1');const data=await response.json();assert.equal(data.threadId,1);assert.deepEqual(data.posts.map(p=>p.id),[1,2]);assert.equal(data.posts[0].message,b+' original');assert.doesNotMatch(JSON.stringify(data),/password|salt|chikoIdentity|unknown/);}
  await admin.request('/admin/login');assert.equal((await admin.form('/admin/login',{login:'root',password})).status,303);
  await mod.request('/admin/login');assert.equal((await mod.form('/admin/login',{login:'boardmod',password})).status,303);
  assert.equal((await admin.request('/admin')).status,200);
  assert.equal((await guest.form('/admin/action',{boardUri:'a',postId:'1',threadId:'1',action:'lock',reason:'test'})).status,303);
  assert.equal((await mod.form('/admin/action',{boardUri:'b',postId:'1',threadId:'1',action:'lock',reason:'forbidden'})).status,403);
  assert.equal((await mod.form('/admin/action',{boardUri:'a',postId:'1',threadId:'1',action:'lock',reason:'test'})).status,303);
  assert.equal((await store.thread('a',1)).locked,true);
  assert.equal((await admin.form('/admin/action',{boardUri:'a',postId:'1',threadId:'1',action:'unlock',reason:'test'})).status,303);
  assert.equal((await store.thread('a',1)).locked,false);
  assert.equal((await admin.form('/admin/action',{boardUri:'a',postId:'1',threadId:'1',action:'pin',reason:'test'})).status,303);
  assert.equal((await store.thread('a',1)).pinned,true);
  assert.equal((await guest.request('/admin/action',{method:'POST',body:new URLSearchParams({csrf:'forged'})})).status,403);
  assert.equal((await admin.form('/admin/staff',{login:'newmod',role:'2',password:'new moderator password'})).status,303);
  assert.equal((await store.user('newmod')).globalRole,2);
  const lesserAdmin=browser();await lesserAdmin.request('/admin/login');assert.equal((await lesserAdmin.form('/admin/login',{login:'administrator',password})).status,303);
  assert.equal((await lesserAdmin.form('/admin/staff',{login:'lower.mod',role:'2',password:'lower moderator password'})).status,303,'administrator may manage moderators');
  assert.equal((await lesserAdmin.form('/admin/staff',{login:'equal.admin',role:'1',password:'another administrator password'})).status,403,'administrator cannot grant equal rank');
  assert.equal((await lesserAdmin.form('/admin/staff',{login:'root',role:'4',disabled:'1'})).status,403,'administrator cannot disable root');
  assert.equal((await admin.form('/admin/board',{boardUri:'a',name:'Updated A',description:'Changed in sidecar',owner:'root',volunteers:'boardmod',theme:'blue'})).status,303);
  assert.equal((await store.board('a')).boardName,'Updated A');
  async function post(threadId=0,files=0){
    const page=await guest.request(threadId?'/a/res/'+threadId+'.html':'/a/',{headers:{'X-Forwarded-For':'203.0.113.10'}});const html=await page.text();
    const action=/action="([^\"]+nativeChallenge[^\"]+)"/.exec(html)?.[1];assert.ok(action,'posting form');
    const token=new URL(action,'http://localhost').searchParams.get('nativeChallenge');const solution=app.locals.compat.captcha.parse(token).answer;
    const impostor=browser();await impostor.request('/a/');
    const stolen=new FormData();for(const [k,v] of Object.entries({csrf:impostor.cookies.get('chiko_csrf'),message:'A copied challenge must fail',nativeAnswer:solution,...(threadId?{threadId:String(threadId)}:{})}))stolen.set(k,v);
    assert.equal((await impostor.request(action,{method:'POST',body:stolen})).status,403,'challenge is bound to its browser cookie');
    const body=new FormData();for(const [k,v] of Object.entries({csrf:guest.cookies.get('chiko_csrf'),message:'>>1 test <script>alert(1)</script>',name:'Name#trip-secret',password:'deletion password',nativeAnswer:solution,...(threadId?{threadId:String(threadId)}:{})}))body.set(k,v);
    const sharp=require('sharp');const png=await sharp({create:{width:2,height:2,channels:3,background:'pink'}}).png().toBuffer();
    for(let i=0;i<files;i++)body.append('files',new Blob([png],{type:'image/png'}),'test.png');
    const response=await guest.request(action,{method:'POST',body,headers:{'X-Forwarded-For':'203.0.113.20'}});assert.equal(response.status,303,await response.text());
    return {location:response.headers.get('location'),action,body};
  }
  const created=await post(0,2);const newId=Number(/res\/(\d+)/.exec(created.location)[1]);assert.equal(newId,6);
  const posted=await store.thread('a',newId);assert.equal(posted.files.length,2);assert.equal(posted.name,'Name');assert.match(posted.tripcode,/^!/);
  const attachment=await guest.request(posted.files[0].path);assert.equal(attachment.status,200);assert.equal(attachment.headers.get('content-type'),'image/png');
  assert.equal((await guest.request(posted.files[0].thumb)).status,200);
  const reply=await post(newId,0);assert.match(reply.location,/#7$/);
  const replay=await guest.request(reply.action,{method:'POST',body:reply.body});assert.equal(replay.status,403);
  const html=await (await guest.request(created.location)).text();assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>alert/);
  assert.equal((await guest.request('/a/catalog.html')).status,200);
  assert.equal((await guest.request('/a/?q=Updated')).status,200);
  assert.equal((await guest.form('/a/report',{postId:String(newId),reason:'Test report'})).status,303);
  const report=await db.collection('chikoReports').findOne({postId:newId});assert.ok(report);
  assert.equal((await admin.form('/admin/report',{id:report._id,boardUri:'a',status:'resolved'})).status,303);
  assert.equal((await db.collection('chikoReportState').findOne({_id:report._id})).status,'resolved');
  assert.equal((await guest.form('/a/delete',{postId:'7',password:'wrong'})).status,403);
  assert.equal((await guest.form('/a/delete',{postId:'7',password:'deletion password'})).status,303);
  assert.ok(await db.collection('posts').findOne({boardUri:'a',postId:7}),'deleted post retained');
  assert.equal((await store.thread('a',newId)).replies.length,0);
  assert.equal((await admin.form('/admin/action',{boardUri:'a',postId:String(newId),threadId:String(newId),action:'ban',reason:'Test ban'})).status,303);
  assert.ok(await store.banned(posted.chikoIdentity,'a'));
  const ban=await db.collection('chikoBans').findOne({active:true});assert.equal((await admin.form('/admin/unban',{id:ban._id})).status,303);assert.equal(await store.banned(posted.chikoIdentity,'a'),false);
  for(const {name,id,bytes} of original)assert.deepEqual(BSON.serialize(await db.collection(name).findOne({_id:id})),bytes,'original '+name+' document unchanged');
  const foreign=Object.create(MongoStore.prototype);foreign.ownsClient=false;foreign.client=client;
  await assert.rejects(foreign.initialize(db.databaseName),/existing database requires/);
  const {exportCopy,importCopy}=require('../scripts/copy-data');
  const bundle=await exportCopy(db),clone=client.db('chiko_staging_unit_'+crypto.randomBytes(8).toString('hex'));
  const copied=await importCopy(clone,bundle);assert.equal(copied.verified,true);
  await assert.rejects(importCopy(clone,bundle),/target must be empty/);
  const lockedApp=await createCompatibleApp({store,origin:'http://localhost',secret:'s'.repeat(40),abuseSecret:'a'.repeat(40),readonly:true,mediaDirectory:folder,legacyDirectory:folder});
  const lockedServer=lockedApp.listen(0,'127.0.0.1');await new Promise(resolve=>lockedServer.once('listening',resolve));t.after(()=>new Promise(resolve=>lockedServer.close(resolve)));
  assert.equal((await fetch('http://127.0.0.1:'+lockedServer.address().port+'/a/post',{method:'POST'})).status,503);
});
