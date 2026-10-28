'use strict';

const express=require('express');
const multer=require('multer');
const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {GridFSBucket}=require('mongodb');
const {pipeline}=require('node:stream/promises');
const {CompatibleStore,BOARD,key}=require('./store');
const {passwordHash,passwordMatches,Sessions}=require('./auth');
const {Media}=require('./media');
const {NativeCaptcha}=require('../lib/native-captcha');
const {parseCookies,httpError,parseNameAndTrip,timingSafeEqualStrings}=require('../lib/utils');
const R=require('./render');

const integer=(value,fallback=0)=>/^\d+$/.test(String(value))&&Number.isSafeInteger(Number(value))?Number(value):fallback;
const text=(value,max=1000)=>typeof value==='string'?value.replace(/\0/g,'').trim().slice(0,max):'';
const passwordText=(value,max=1024)=>typeof value==='string'&&value.length<=max?value:'';
const publicFile=f=>({originalName:f.originalName,path:f.path,thumb:f.thumb,mime:f.mime,size:f.size,width:f.width,height:f.height});
const publicPost=(p,opening=false)=>({id:opening?p.threadId:p.postId,threadId:p.threadId,boardUri:p.boardUri,name:p.name,tripcode:p.tripcode,subject:p.subject,message:p.message,creation:p.creation,files:(p.files || []).map(publicFile)});

async function createCompatibleApp(settings={}) {
  const origin=settings.origin || process.env.PUBLIC_ORIGIN;
  if(!origin || new URL(origin).origin!==origin)throw new Error('PUBLIC_ORIGIN must be an explicit origin.');
  const secure=origin.startsWith('https://');
  const secret=settings.secret || process.env.ADMIN_SESSION_SECRET;
  const abuseSecret=settings.abuseSecret || process.env.ABUSE_FINGERPRINT_SECRET;
  if(!secret || secret.length<32 || !abuseSecret || abuseSecret.length<32 || secret===abuseSecret)throw new Error('Configure independent session and abuse secrets with at least 32 characters.');
  const readonly=settings.readonly ?? process.env.CHIKO_WRITES_ENABLED!=='true';
  if(process.env.NODE_ENV==='production'&&!readonly&&process.env.CHIKO_DEPLOYMENT_ROLE!=='staging'&&process.env.CHIKO_MIGRATION_APPROVED!=='true')throw new Error('Production writes require the migration acceptance gate.');
  const store=settings.store || new CompatibleStore({uri:process.env.MONGODB_URI || process.env.MONGO_URL,database:process.env.CHIKO_DATABASE});
  await store.ready;
  const sessions=new Sessions(secret,secure);
  const media=new Media(settings.mediaDirectory || process.env.CHIKO_MEDIA_DIR || '/data/chiko-media');
  const legacyDirectory=path.resolve(settings.legacyDirectory || process.env.CHIKO_LEGACY_MEDIA_DIR || '/data/legacy-media');
  const app=express();
  app.disable('x-powered-by');
  // Only explicitly configured, verified peers can supply forwarding headers.
  const proxy=settings.trustProxy ?? process.env.TRUST_PROXY;
  if(proxy==='true' || proxy===true)throw new Error('Use verified proxy CIDRs instead of TRUST_PROXY=true.');
  if(proxy)app.set('trust proxy',proxy==='1'?1:proxy);
  const nonceStore={async issue(nonce,expiresAt){try{await store.db.collection('chikoCaptchaNonces').insertOne({_id:nonce,expiresAt:new Date(expiresAt)});return true;}catch(error){if(error.code===11000)return false;throw error;}}};
  const captcha=new NativeCaptcha({postingAuthorization:{enabled:true,secret},antiAbuse:{turnstile:{enabled:false}},deployment:{publicOrigin:origin}},nonceStore);
  await store.db.collection('chikoCaptchaNonces').createIndex({expiresAt:1},{expireAfterSeconds:0});
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:25*1024*1024,files:4,fields:15,fieldSize:20000,parts:20}}).array('files',4);
  let uploading=0;
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'});
    if(secure)res.set('Strict-Transport-Security','max-age=15552000');
    res.set('Cache-Control','private, no-store');
    req.identity=crypto.createHmac('sha256',abuseSecret).update(`poster:${req.ip}`).digest('base64url');
    next();
  });
  app.use('/assets',express.static(path.join(__dirname,'public'),{dotfiles:'deny',index:false}));
  app.get('/healthz',(_req,res)=>res.json({status:'ok',application:'ChikoChan',readonly}));
  app.get('/readyz',async(_req,res)=>{await store.db.command({ping:1});res.json({status:'ready'});});
  app.use(async(req,res,next)=>{
    try {
      req.session=sessions.read(req);
      req.user=req.session?await store.user(req.session.login):null;
      if(!req.user || req.user.chikoDisabled || req.user.sessionVersion!==req.session?.version){req.user=null;req.session=null;}
      let token=parseCookies(req.headers.cookie).chiko_csrf;
      const valid=()=>{const [nonce,expires,signature,extra]=String(token || '').split('.');return !extra&&nonce&&Number(expires)>Date.now()&&timingSafeEqualStrings(signature,sessions.sign(`form:${nonce}:${expires}`));};
      if(!valid()) {
        const nonce=crypto.randomBytes(24).toString('base64url'),expires=Date.now()+2*3600000;
        token=`${nonce}.${expires}.${sessions.sign(`form:${nonce}:${expires}`)}`;
        res.append('Set-Cookie',`chiko_csrf=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${secure?'; Secure':''}`);
      }
      req.csrf=token;
      next();
    }catch(error){next(error);}
  });
  app.use(express.urlencoded({extended:false,limit:'32kb',parameterLimit:30}));
  function protect(req,_res,next){
    if(req.headers.origin && req.headers.origin!==origin)return next(httpError(403,'Request origin is not allowed.'));
    if(!timingSafeEqualStrings(req.body.csrf,parseCookies(req.headers.cookie).chiko_csrf || '') || !timingSafeEqualStrings(req.body.csrf,req.csrf))return next(httpError(403,'The form expired. Reload the page and try again.'));
    next();
  }
  function writes(_req,_res,next){next(readonly?httpError(503,'This migration preview is read-only.'):undefined);}
  function signedIn(req,res,next){if(!req.user)return res.redirect(303,'/admin/login');next();}
  async function context(req){return {boards:await store.boards(),user:req.user,readonly};}
  async function page(req,res,title,html,extra={}){res.type('html').send(R.layout(title,html,{...await context(req),...extra}));}
  async function boardFor(req){const board=BOARD.test(req.params.board || '')?await store.board(req.params.board):null;if(!board)throw httpError(404,'Board not found.');return board;}
  function issueCaptcha(req,res,board,threadId=0){const session=captcha.session(req,res);req.challenge=captcha.issue({board,thread:threadId,addressKey:req.identity,session});}
  function back(res,board,threadId){res.redirect(303,threadId?R.url(board,threadId):`/${R.enc(board)}/`);}
  const directory=boards=>`<div class="directory">${boards.map(b=>`<a class="card" href="/${R.enc(b.boardUri)}/"><strong>/${R.e(b.boardUri)}/ — ${R.e(b.boardName)}</strong><p>${R.e(b.boardDescription || '')}</p></a>`).join('')}</div>`;

  app.get('/',async(req,res)=>{
    const boards=await store.boards();
    await page(req,res,'Welcome',`<section class="hero"><span class="eyebrow">Anonymous conversations, familiar faces</span><h1>A little corner of the internet.</h1><p>Share an image, start a conversation, or settle into your favorite board. Welcome to ChikoChan.</p><a href="/boards">Explore all boards →</a></section><h2>Find your people</h2>${directory(boards)}`);
  });
  app.get('/boards',async(req,res)=>page(req,res,'Boards',`<h1>Board directory</h1>${directory(await store.boards())}`));
  app.get('/api/boards',async(_req,res)=>res.json((await store.boards()).map(b=>({uri:b.boardUri,name:b.boardName,description:b.boardDescription}))));
  app.get('/api/:board/thread/:id',async(req,res)=>{
    await boardFor(req);const t=await store.thread(req.params.board,integer(req.params.id));if(!t)throw httpError(404,'Thread not found.');
    res.json({boardUri:t.boardUri,threadId:t.threadId,locked:!!t.locked,pinned:!!t.pinned,posts:[publicPost(t,true),...t.replies.map(p=>publicPost(p))]});
  });

  async function referenced(filename){
    const threads=await store.db.collection('threads').find({trash:{$ne:true},$or:[{'files.path':filename},{'files.thumb':filename}]}).toArray();
    for(const t of threads)if(await store.thread(t.boardUri,t.threadId))return true;
    const posts=await store.db.collection('posts').find({trash:{$ne:true},$or:[{'files.path':filename},{'files.thumb':filename}]}).toArray();
    for(const p of posts){const t=await store.thread(p.boardUri,p.threadId);if(t?.replies.some(v=>v.postId===p.postId))return true;}
    return false;
  }
  app.get('/media/:file',async(req,res,next)=>{
    if(!/^[a-f0-9]{64}(?:\.thumb\.jpg|\.(?:jpg|png|gif|webp|mp4|webm))$/.test(req.params.file)||!await referenced(`/media/${req.params.file}`))throw httpError(404,'Attachment not found.');
    res.sendFile(path.join(media.directory,req.params.file),error=>{if(error)next(error);});
  });
  app.get('/.media/:file',async(req,res,next)=>{
    if(!/^[A-Za-z0-9_.-]{1,180}$/.test(req.params.file)||!await referenced(`/.media/${req.params.file}`))throw httpError(404,'Attachment not found.');
    const file=await store.db.collection('fs.files').findOne({filename:`/.media/${req.params.file}`});
    if(!file)throw httpError(404,'Attachment not found.');
    const contentType=/^(?:image\/(?:png|jpeg|gif|webp)|video\/(?:mp4|webm)|audio\/(?:mpeg|ogg|webm))$/.test(file.contentType)?file.contentType:'application/octet-stream';
    res.type(contentType);if(contentType==='application/octet-stream')res.set('Content-Disposition','attachment');
    if(file.onDisk){const id=String(file._id);if(!/^[a-f0-9]{24}$/.test(id))throw httpError(404,'Attachment not found.');return res.sendFile(path.join(legacyDirectory,id.slice(-3),id),error=>{if(error)next(error);});}
    let start=0,end=Number(file.length);
    if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match||(!match[1]&&!match[2]))throw httpError(416,'Unsupported range.');if(!match[1])start=Math.max(0,end-integer(match[2]));else{start=integer(match[1]);if(match[2])end=Math.min(end,integer(match[2])+1);}if(start>=end)throw httpError(416,'Unsatisfiable range.');res.status(206).set('Content-Range',`bytes ${start}-${end-1}/${file.length}`);}
    res.set({'Content-Length':String(end-start),'Accept-Ranges':'bytes'});
    try{await pipeline(new GridFSBucket(store.db).openDownloadStream(file._id,{start,end}),res);}catch(error){if(!res.headersSent)next(error);}
  });

  app.get('/admin/login',async(req,res)=>page(req,res,'Staff login',`<section class="compose"><h1>Staff login</h1><form action="/admin/login" method="post">${R.csrf(req)}<label>Account<input name="login" maxlength="80" required autocomplete="username"></label><label>Password<input type="password" name="password" maxlength="1024" required autocomplete="current-password"></label><button>Sign in</button></form><p class="hint">Existing compatible passwords continue to work. Accounts with an unsupported credential format require an explicitly authorized recovery.</p></section>`));
  app.post('/admin/login',protect,async(req,res)=>{
    await store.rateLimit(req.identity,'login',8,15*60000);
    const user=await store.user(text(req.body.login,80));
    if(!user || user.chikoDisabled || !await passwordMatches(user,passwordText(req.body.password)))throw httpError(403,'Account or password is incorrect.');
    sessions.set(res,sessions.issue(user.login,user.sessionVersion));res.redirect(303,'/admin');
  });
  app.post('/admin/logout',protect,(req,res)=>{sessions.set(res,'');res.redirect(303,'/');});

  app.get('/admin',signedIn,async(req,res)=>{
    const boards=(await store.boards()).filter(b=>store.can(req.user,b));
    if(!boards.length&&!store.can(req.user))throw httpError(403,'This account has no moderation permissions.');
    const scopes=boards.map(b=>b.boardUri),global=store.can(req.user);
    const filter=global?{}:{boardUri:{$in:scopes}};
    const [reports,legacyReports,bans,legacyBans,audit,legacyAudit,users]=await Promise.all([
      store.db.collection('chikoReports').find(filter).sort({at:-1}).limit(100).toArray(),
      store.db.collection('reports').find(filter).limit(100).toArray(),
      store.db.collection('chikoBans').find(global?{}:{boardUri:{$in:scopes}}).limit(100).toArray(),
      store.db.collection('bans').find(filter,{projection:{ip:0,ipHash:0,range:0}}).limit(100).toArray(),
      store.db.collection('chikoAudit').find(filter).sort({at:-1}).limit(100).toArray(),
      store.db.collection('staffLogs').find(filter,{projection:{cache:0}}).sort({time:-1}).limit(100).toArray(),
      store.can(req.user,null,'staff')?store.users():[]
    ]);
    const resolution=new Map((await store.db.collection('chikoReportState').find({}).toArray()).map(v=>[v._id,v.status]));
    const table=(headers,rows)=>`<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${headers.length}">No records.</td></tr>`}</tbody></table></div>`;
    const reportRows=[...reports,...legacyReports].map(v=>`<tr><td>/${R.e(v.boardUri)}/ <a href="/${R.enc(v.boardUri)}/post/${integer(v.postId || v.threadId)}">No.${integer(v.postId || v.threadId)}</a></td><td>${R.e(v.reason || v.category || 'Report')}</td><td>${R.e(resolution.get(String(v._id)) || v.status || 'open')}</td><td><form method="post" action="/admin/report">${R.csrf(req)}<input type="hidden" name="id" value="${R.e(v._id)}"><input type="hidden" name="boardUri" value="${R.e(v.boardUri)}"><button name="status" value="resolved">Resolve</button><button name="status" value="open">Reopen</button></form></td></tr>`);
    const boardForms=boards.map(b=>`<details class="card"><summary>/${R.e(b.boardUri)}/ settings</summary><form method="post" action="/admin/board">${R.csrf(req)}<input type="hidden" name="boardUri" value="${R.e(b.boardUri)}"><label>Name<input name="name" value="${R.e(b.boardName)}" required maxlength="120"></label><label>Description<textarea name="description" maxlength="4000">${R.e(b.boardDescription)}</textarea></label><label>Owner<input name="owner" value="${R.e(b.owner)}" maxlength="80"></label><label>Moderators (comma separated)<input name="volunteers" value="${R.e((b.volunteers || []).join(','))}" maxlength="2000"></label><label>Appearance<select name="theme">${['rose','blue','green'].map(v=>`<option ${v===b.chikoTheme?'selected':''}>${v}</option>`).join('')}</select></label><label><input type="checkbox" name="closed" value="1" ${b.chikoClosed?'checked':''}> Close posting</label><button>Save board</button></form></details>`).join('');
    const staff=users.length?`<h2>Accounts and permissions</h2>${table(['Account','Role','Credential','Access'],users.map(u=>`<tr><td>${R.e(u.login)}</td><td>${R.e(u.globalRole ?? 'board staff')}</td><td>${u.chikoPasswordHash?'ChikoChan scrypt':u.chikoLegacyScryptHash?'Preserved scrypt':R.e(u.passwordMethod || 'Recovery required')}</td><td>${u.chikoDisabled?'Disabled':'Enabled'}</td></tr>`))}<details class="card"><summary>Create / manage staff</summary><form method="post" action="/admin/staff">${R.csrf(req)}<label>Account<input name="login" maxlength="80" required></label><label>Role<select name="role"><option value="3">Janitor</option><option value="2">Moderator</option><option value="1">Administrator</option><option value="board">Board staff only</option></select></label><label>Initial password for a new account<input type="password" name="password" minlength="12" maxlength="200" autocomplete="new-password"></label><label><input type="checkbox" name="disabled" value="1"> Disable account / revoke sessions</label><button>Save account</button><p class="hint">Existing account passwords are preserved. Board permissions are managed in board settings.</p></form></details>`:'';
    await page(req,res,'Administration',`<div class="toolbar"><h1>ChikoChan administration</h1><form method="post" action="/admin/logout">${R.csrf(req)}<button>Sign out</button></form></div><h2>Reports</h2>${table(['Post','Reason','Status','Action'],reportRows)}<h2>Boards</h2><div class="admin-grid">${boardForms}${store.can(req.user)?`<details class="card"><summary>Create board</summary><form method="post" action="/admin/board">${R.csrf(req)}<label>Board URI<input name="boardUri" pattern="[A-Za-z0-9_-]{1,32}" required></label><label>Name<input name="name" maxlength="120" required></label><label>Description<input name="description" maxlength="4000"></label><button>Create board</button></form></details>`:''}</div>${staff}<h2>Bans</h2>${table(['Scope','Reason','Status','Action'],bans.map(v=>`<tr><td>${R.e(v.boardUri || 'Global')}</td><td>${R.e(v.reason)}</td><td>${v.active?'Active':'Revoked'}</td><td><form method="post" action="/admin/unban">${R.csrf(req)}<input type="hidden" name="id" value="${R.e(v._id)}"><button>Revoke</button></form></td></tr>`))}<p>${legacyBans.length} original ban records preserved.</p><h2>Moderation history</h2>${table(['Time','Staff','Action','Target'],[...audit.map(v=>`<tr><td>${R.e(v.at?.toISOString())}</td><td>${R.e(v.actor)}</td><td>${R.e(v.action)}</td><td>/${R.e(v.boardUri)}/ ${R.e(v.target)} ${R.e(v.detail)}</td></tr>`),...legacyAudit.map(v=>`<tr><td>${R.e(v.time?.toISOString?.() || '')}</td><td>${R.e(v.user)}</td><td>${R.e(v.type)}</td><td>${R.e(v.description)}</td></tr>`)])}`);
  });

  app.post('/admin/board',protect,writes,signedIn,async(req,res)=>{
    const uri=text(req.body.boardUri,32);if(!BOARD.test(uri))throw httpError(400,'Invalid board URI.');
    const existing=await store.board(uri);
    if(!store.can(req.user,existing,'board'))throw httpError(403,'Board management permission required.');
    const owner=text(req.body.owner,80) || existing?.owner || req.user.login;
    if(!await store.user(owner))throw httpError(400,'The owner account does not exist.');
    const volunteers=text(req.body.volunteers,2000).split(',').map(s=>s.trim()).filter(Boolean);
    if(volunteers.length>50)throw httpError(400,'Too many moderators.');
    for(const login of volunteers)if(!await store.user(login))throw httpError(400,'A moderator account does not exist.');
    const values={boardName:text(req.body.name,120),boardDescription:text(req.body.description,4000),owner,volunteers,chikoTheme:['rose','blue','green'].includes(req.body.theme)?req.body.theme:'rose',chikoClosed:req.body.closed==='1'};
    if(!values.boardName)throw httpError(400,'A board name is required.');
    if(existing)await store.db.collection('chikoBoardState').updateOne({_id:uri},{$set:values},{upsert:true});
    else await store.db.collection('boards').insertOne({boardUri:uri,...values,lastPostId:0,settings:[],creation:new Date(),chikoCreated:true});
    await store.audit(req.user,'board-settings',uri,uri);res.redirect(303,'/admin');
  });
  app.post('/admin/staff',protect,writes,signedIn,async(req,res)=>{
    if(!store.can(req.user,null,'staff'))throw httpError(403,'Root permission required.');
    const login=text(req.body.login,80);if(!/^[A-Za-z0-9_.-]{1,80}$/.test(login))throw httpError(400,'Invalid account name.');
    if(login===req.user.login)throw httpError(400,'Manage another account to preserve your recovery access.');
    const existing=await store.user(login),disabled=req.body.disabled==='1';
    const role=req.body.role==='board'?4:integer(req.body.role,-1);if(![1,2,3,4].includes(role))throw httpError(400,'Invalid staff role.');
    const fields={globalRole:role,chikoDisabled:disabled};
    if(!existing){const password=passwordText(req.body.password,200);if(password.length<12)throw httpError(400,'New accounts need a password of at least 12 characters.');fields.chikoPasswordHash=await passwordHash(password);}
    else if(req.body.password)throw httpError(400,'Existing passwords cannot be reset through this form.');
    await store.db.collection('chikoAccounts').updateOne({_id:login},{$set:fields,$inc:{sessionVersion:1}},{upsert:true});
    await store.audit(req.user,'staff-permissions','',login);res.redirect(303,'/admin');
  });
  app.post('/admin/action',protect,writes,signedIn,async(req,res)=>{
    const board=await store.board(text(req.body.boardUri,32));if(!board || !store.can(req.user,board))throw httpError(403,'Permission denied.');
    const id=integer(req.body.postId),threadId=integer(req.body.threadId),reason=text(req.body.reason,1000);if(!reason)throw httpError(400,'A reason is required.');
    const action=req.body.action;
    if(['lock','unlock','pin','unpin'].includes(action))await store.setThread(req.user,board,threadId,['lock','unlock'].includes(action)?'locked':'pinned',['lock','pin'].includes(action));
    else if(action==='hide')await store.removePost(req.user,board,id,reason);
    else if(action==='ban'){
      if(!store.can(req.user,board,'ban'))throw httpError(403,'Ban permission required.');
      const post=await store.post(board.boardUri,id);if(!post?.chikoIdentity)throw httpError(400,'This historical post has no compatible poster identifier. No ban was created.');
      await store.db.collection('chikoBans').insertOne({_id:crypto.randomUUID(),identity:post.chikoIdentity,boardUri:board.boardUri,active:true,reason,expiresAt:new Date(Date.now()+86400000),at:new Date()});
      await store.audit(req.user,'ban',board.boardUri,id,reason);
    }else throw httpError(400,'Unknown action.');
    res.redirect(303,'/admin');
  });
  app.post('/admin/unban',protect,writes,signedIn,async(req,res)=>{
    const ban=await store.db.collection('chikoBans').findOne({_id:text(req.body.id,80)});
    if(!ban || !store.can(req.user,await store.board(ban.boardUri),'ban'))throw httpError(403,'Permission denied.');
    await store.db.collection('chikoBans').updateOne({_id:ban._id},{$set:{active:false}});await store.audit(req.user,'unban',ban.boardUri,ban._id);res.redirect(303,'/admin');
  });
  app.post('/admin/report',protect,writes,signedIn,async(req,res)=>{
    const id=text(req.body.id,80),boardUri=text(req.body.boardUri,32),board=await store.board(boardUri);
    if(!board || !store.can(req.user,board))throw httpError(403,'Permission denied.');
    const {ObjectId}=require('mongodb');
    const report=await store.db.collection('chikoReports').findOne({_id:id,boardUri}) || (ObjectId.isValid(id)?await store.db.collection('reports').findOne({_id:new ObjectId(id),boardUri}):null);
    if(!report || !['resolved','open'].includes(req.body.status))throw httpError(400,'Invalid report.');
    await store.db.collection('chikoReportState').updateOne({_id:id},{$set:{status:req.body.status,at:new Date(),actor:req.user.login}},{upsert:true});
    await store.audit(req.user,'report-'+req.body.status,boardUri,id);res.redirect(303,'/admin');
  });

  app.post('/:board/report',protect,writes,async(req,res)=>{
    const board=await boardFor(req),postId=integer(req.body.postId),post=await store.post(board.boardUri,postId),reason=text(req.body.reason,1000);
    if(!post || !reason)throw httpError(400,'A post and report reason are required.');
    await store.rateLimit(req.identity,'report',5,10*60000);
    await store.db.collection('chikoReports').insertOne({_id:crypto.randomUUID(),boardUri:board.boardUri,postId,threadId:post.threadId,reason,status:'open',at:new Date()});back(res,board.boardUri,post.threadId);
  });
  app.post('/:board/delete',protect,writes,async(req,res)=>{
    const board=await boardFor(req),postId=integer(req.body.postId),post=await store.post(board.boardUri,postId);
    await store.rateLimit(req.identity,'delete',10,15*60000);
    const credential=post && await store.db.collection('chikoPostCredentials').findOne({_id:key(board.boardUri,postId)});
    const own=post && await passwordMatches({chikoPasswordHash:post.chikoDeletionHash,chikoLegacyScryptHash:credential?.nativeScryptHash},passwordText(req.body.password,200));
    await store.removePost(req.user,board,postId,'Post author deletion',own);back(res,board.boardUri,postId===post.threadId?0:post.threadId);
  });
  app.post('/:board/post',writes,async(req,res,next)=>{
    try{
      if(uploading>=1)throw httpError(503,'Uploads are busy. Please try again shortly.');
      if(req.headers.origin&&req.headers.origin!==origin)throw httpError(403,'Request origin is not allowed.');
      await boardFor(req);
      await store.rateLimit(req.identity,'upload',12,60000);
      uploading++;
      let released=false;const release=()=>{if(!released){uploading--;released=true;}};
      res.once('finish',release);res.once('close',release);
      // A bounded body parser runs only after global and per-client admission.
      const timeout=setTimeout(()=>req.destroy(),30000);timeout.unref();
      upload(req,res,error=>{clearTimeout(timeout);if(error){release();return next(error);}next();});
    }catch(error){next(error);}
  },protect,async(req,res)=>{
    const board=await boardFor(req),threadId=integer(req.body.threadId),message=text(req.body.message,16000);
    if(req.body.website || (!message && !req.files?.length))throw httpError(400,'A message or attachment is required.');
    const challenge=await captcha.consume(req,{board:board.boardUri,thread:threadId,addressKey:req.identity});captcha.verify(challenge,req.body.nativeAnswer);
    await store.rateLimit(req.identity,threadId?'reply':'thread',threadId?8:3,threadId?60000:10*60000);
    if(await store.banned(req.identity,board.boardUri))throw httpError(403,'Posting is restricted for this connection.');
    if(threadId){const t=await store.thread(board.boardUri,threadId);if(!t || t.locked || t.archived)throw httpError(403,'This thread is unavailable for replies.');}
    const files=[];for(const file of req.files || [])files.push(await media.save(file));
    const name=parseNameAndTrip(text(req.body.name,80),board.anonymousName || 'Anonymous',secret);
    const deletionPassword=passwordText(req.body.password,200);
    const result=await store.createPost(board.boardUri,threadId,{message,subject:text(req.body.subject,120),name:name.name,tripcode:name.trip,files,email:req.body.sage==='1'?'sage':'',chikoIdentity:req.identity,chikoDeletionHash:deletionPassword?await passwordHash(deletionPassword):''});
    res.redirect(303,`${R.url(board.boardUri,result.threadId)}#${result.id}`);
  });

  app.get('/:board/post/:id',async(req,res)=>{const board=await boardFor(req),id=integer(req.params.id),p=await store.post(board.boardUri,id);if(!p || !await store.thread(board.boardUri,p.threadId))throw httpError(404,'Post not found.');res.redirect(302,`${R.url(board.boardUri,p.threadId)}#${id}`);});
  app.get('/:board/thread/:id',async(req,res)=>{
    const board=await boardFor(req),oldId=integer(req.params.id);
    const map=await store.db.collection('chikoIdMap').findOne({oldId,boardUri:board.boardUri});
    const threadId=map?.threadId || oldId;if(!await store.thread(board.boardUri,threadId))throw httpError(404,'Thread not found.');res.redirect(301,`${R.url(board.boardUri,threadId)}${map?.postId?'#'+map.postId:''}`);
  });
  app.get('/:board/res/:file',async(req,res)=>{
    const board=await boardFor(req),match=/^(\d+)\.html$/.exec(req.params.file),id=match?integer(match[1]):0;
    const thread=await store.thread(board.boardUri,id);if(!thread)throw httpError(404,'Thread not found.');
    issueCaptcha(req,res,board.boardUri,id);
    await page(req,res,`${board.boardName} — No.${id}`,`<div class="toolbar"><a href="/${R.enc(board.boardUri)}/">← /${R.e(board.boardUri)}/</a><a href="/${R.enc(board.boardUri)}/catalog.html">Catalog</a></div>${R.thread(thread,req,store.can(req.user,board),true)}${!readonly&&!thread.locked&&!thread.archived?R.form(req,board,id):`<p>${readonly?'Posting is disabled in this migration preview.':'This thread is closed to new replies.'}</p>`}`,{board});
  });
  async function boardPage(req,res,catalog=false){
    const board=await boardFor(req),pageNumber=Math.max(1,Math.min(100000,integer(req.query.page,1))),q=text(req.query.q,200);
    const {count,threads}=await store.threads(board.boardUri,{page:pageNumber,limit:catalog?50:10,search:q,catalog});
    issueCaptcha(req,res,board.boardUri);
    const b=R.enc(board.boardUri);
    await page(req,res,`/${board.boardUri}/ — ${board.boardName}`,`<span class="eyebrow">/${R.e(board.boardUri)}/</span><h1>${R.e(board.boardName)}</h1><p>${R.e(board.boardDescription)}</p>${board.boardMessage?`<p class="notice">${R.e(board.boardMessage)}</p>`:''}<div class="toolbar"><nav><a href="/${b}/">Threads</a><a href="/${b}/catalog.html">Catalog</a></nav><form method="get"><input name="q" value="${R.e(q)}" maxlength="200" placeholder="Search this board" aria-label="Search threads"><button>Search</button></form></div>${!readonly&&!board.chikoClosed?R.form(req,board,0):''}${catalog?`<div class="catalog">${threads.map(t=>`<a class="card" href="${R.url(t.boardUri,t.threadId)}">${t.files?.[0]?.thumb&&/^\/(?:\.media|media)\/[A-Za-z0-9_.-]+$/.test(t.files[0].thumb)?`<img loading="lazy" src="${R.e(t.files[0].thumb)}" alt="Thread thumbnail">`:''}<strong>No.${t.threadId} ${R.e(t.subject)}</strong><div class="excerpt">${R.e(text(t.message,220))}</div><small>${t.replyCount} replies</small></a>`).join('')}</div>`:threads.map(t=>R.thread(t,req,store.can(req.user,board))).join('')}${!threads.length?'<p>No matching threads.</p>':''}<nav class="pagination">${pageNumber>1?`<a href="?page=${pageNumber-1}&q=${R.enc(q)}">← Previous</a>`:''}<span>Page ${pageNumber} · ${count} threads</span>${pageNumber*(catalog?50:10)<count?`<a href="?page=${pageNumber+1}&q=${R.enc(q)}">Next →</a>`:''}</nav>`,{board});
  }
  app.get('/:board/catalog.html',(req,res)=>boardPage(req,res,true));
  app.get('/:board/catalog',(req,res)=>boardPage(req,res,true));
  app.get('/:board/',(req,res)=>boardPage(req,res));
  app.use((_req,_res,next)=>next(httpError(404,'Page not found.')));
  app.use(async(error,req,res,_next)=>{
    if(res.headersSent)return res.destroy();
    const status=error instanceof multer.MulterError?400:(Number.isInteger(error.status)&&error.status>=400&&error.status<600?error.status:500);
    // Database, filesystem and driver errors can contain secrets. Never expose
    // their messages or stack traces to visitors or routine runtime logs.
    res.status(status);res.set('Cache-Control','no-store');
    const message=status===500?'The request could not be completed. Please try again.':error instanceof multer.MulterError?'The upload exceeds the file or form limits.':error.message;
    try{await page(req,res,String(status),`<section class="error"><h1>${status}</h1><p>${R.e(message)}</p><a href="/">Return home</a></section>`);}catch{res.type('text').send('ChikoChan is temporarily unavailable.');}
  });
  app.locals.compat={store,sessions,captcha,readonly,media,close:()=>store.close()};
  return app;
}

module.exports={createCompatibleApp,publicPost};
