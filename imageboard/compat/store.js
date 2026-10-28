'use strict';

const { MongoClient, BSON } = require('mongodb');
const { createHash, randomUUID } = require('node:crypto');
const { httpError } = require('../lib/utils');

const BOARD = /^[A-Za-z0-9_-]{1,32}$/;
const key = (board, id) => `${board}:${id}`;
const hidden = { $ne: true };

class CompatibleStore {
  constructor({ uri, database, client, allowEmpty = false }) {
    if (!database) throw new Error('An explicit CHIKO_DATABASE is required.');
    this.client = client || new MongoClient(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 20 });
    this.ownsClient = !client;
    this.db = this.client.db(database);
    this.ready = this.initialize(allowEmpty);
  }
  async initialize(allowEmpty) {
    if (this.ownsClient) await this.client.connect();
    const boards = await this.db.collection('boards').find({}).toArray();
    if (!boards.length && !allowEmpty) throw new Error('Source boards are missing; refusing to seed an empty database.');
    if (boards.some(board => !BOARD.test(board.boardUri || ''))) throw new Error('Unsupported board identifiers require explicit mapping.');
    const release = await this.db.collection('witnessedReleases').findOne({ active: true });
    if (!release || release.version !== 16) throw new Error('Unsupported or missing source schema version.');
    // Only ChikoChan sidecar collections get new indexes. Original indexes and
    // records, including unknown metadata and expired records, stay untouched.
    await this.db.collection('chikoRateLimits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.db.collection('chikoAudit').createIndex({ at: -1 });
    return this;
  }
  async close() { if (this.ownsClient) await this.client.close(); }
  async boards() {
    const [boards, state] = await Promise.all([this.db.collection('boards').find({}).toArray(), this.db.collection('chikoBoardState').find({}).toArray()]);
    const map = new Map(state.map(v => [v._id, v]));
    return boards.map(v => ({ ...v, ...map.get(v.boardUri), _id: v._id })).sort((a,b) => a.boardUri.localeCompare(b.boardUri));
  }
  async board(uri) { return (await this.boards()).find(v => v.boardUri === uri) || null; }
  async user(login) {
    const [legacy, current] = await Promise.all([this.db.collection('users').findOne({ login }), this.db.collection('chikoAccounts').findOne({ _id: login })]);
    if (!legacy && !current) return null;
    return { ...legacy, ...current, login, chikoDisabled:current?.chikoDisabled ?? legacy?._chikoMigration?.sourceEnabled===false, sessionVersion: current?.sessionVersion || 0 };
  }
  async users() {
    const names = new Set([...(await this.db.collection('users').distinct('login')), ...(await this.db.collection('chikoAccounts').distinct('_id'))]);
    return Promise.all([...names].map(v => this.user(v)));
  }
  can(user, board = null, action = 'moderate') {
    if (!user || user.chikoDisabled) return false;
    if (Number.isInteger(user.globalRole) && user.globalRole >= 0 && user.globalRole <= 1) return true;
    if (action === 'staff') return false;
    if (user.globalRole === 2 && ['moderate','thread','ban','report','delete'].includes(action)) return true;
    if (user.globalRole === 3 && ['moderate','report','delete'].includes(action)) return true;
    if (!board) return false;
    if (board.owner === user.login) return true;
    return ['moderate','thread','ban','report','delete'].includes(action) && Array.isArray(board.volunteers) && board.volunteers.includes(user.login);
  }
  async overlayPosts(boardUri, threads, posts) {
    const [states, removals] = await Promise.all([
      this.db.collection('chikoThreadState').find({ boardUri }).toArray(),
      this.db.collection('chikoRemovals').find({ boardUri, active: true }).toArray()
    ]);
    const state = new Map(states.map(v => [v.threadId, v]));
    const removed = new Set(removals.map(v => v.postId));
    return threads.filter(t => !removed.has(t.threadId)).map(t => ({
      ...t, ...state.get(t.threadId), _id: t._id, boardUri: t.boardUri, threadId: t.threadId,
      replies: posts.filter(p => p.threadId === t.threadId && !removed.has(p.postId)).sort((a,b) => a.postId-b.postId)
    }));
  }
  async threads(boardUri, { search = '', page = 1, limit = 10, catalog = false } = {}) {
    // Search is literal, bounded and scoped. Never treat user text as a regex.
    const query = { boardUri, trash: hidden };
    let candidates = await this.db.collection('threads').find(query).toArray();
    const replies = await this.db.collection('posts').find({ boardUri, trash: hidden }).toArray();
    let threads = await this.overlayPosts(boardUri, candidates, replies);
    if (search) {
      const needle = String(search).slice(0,200).toLowerCase();
      threads = threads.filter(t => [t,...t.replies].some(p => `${p.subject || ''}\n${p.message || ''}\n${p.name || ''}`.toLowerCase().includes(needle)));
    }
    threads.sort((a,b) => Number(!!b.pinned)-Number(!!a.pinned) || new Date(b.lastBump || b.creation)-new Date(a.lastBump || a.creation));
    const count = threads.length;
    return { count, threads: threads.slice((page-1)*limit, page*limit).map(t => ({ ...t, replyCount: t.replies.length, replies: catalog ? [] : t.replies.slice(-3) })) };
  }
  async thread(boardUri, threadId) {
    const thread = await this.db.collection('threads').findOne({ boardUri, threadId, trash: hidden });
    if (!thread) return null;
    const posts = await this.db.collection('posts').find({ boardUri, threadId, trash: hidden }).toArray();
    return (await this.overlayPosts(boardUri, [thread], posts))[0] || null;
  }
  async post(boardUri, postId) {
    return await this.db.collection('threads').findOne({ boardUri, threadId: postId }) || await this.db.collection('posts').findOne({ boardUri, postId });
  }
  async nextId(boardUri) {
    const [board, thread, post] = await Promise.all([
      this.db.collection('boards').findOne({ boardUri }),
      this.db.collection('threads').find({ boardUri }).sort({ threadId: -1 }).limit(1).next(),
      this.db.collection('posts').find({ boardUri }).sort({ postId: -1 }).limit(1).next()
    ]);
    const highest = Math.max(Number(board?.lastPostId) || 0, thread?.threadId || 0, post?.postId || 0);
    try { await this.db.collection('chikoCounters').updateOne({ _id: boardUri }, { $max: { value: highest } }, { upsert: true }); }
    catch (error) { if (error.code !== 11000) throw error; }
    const result = await this.db.collection('chikoCounters').findOneAndUpdate({ _id: boardUri }, { $inc: { value: 1 } }, { returnDocument: 'after' });
    if (!Number.isSafeInteger(result.value) || result.value <= highest) throw new Error('Invalid post counter.');
    return result.value;
  }
  async createPost(boardUri, threadId, fields) {
    const board = await this.board(boardUri);
    if (!board || board.chikoClosed) throw httpError(403, 'This board is closed.');
    if (threadId) {
      const thread = await this.thread(boardUri, threadId);
      if (!thread || thread.locked || thread.archived) throw httpError(403, 'This thread is unavailable for replies.');
    }
    const id = await this.nextId(boardUri);
    const now = new Date();
    const doc = { ...fields, boardUri, threadId: threadId || id, creation: now, chikoCreated: true };
    if (threadId) {
      doc.postId = id;
      await this.db.collection('posts').insertOne(doc);
      await this.db.collection('chikoThreadState').updateOne({ _id: key(boardUri,threadId) }, { $set: { boardUri, threadId, lastBump: fields.email === 'sage' ? (await this.thread(boardUri,threadId)).lastBump : now } }, { upsert: true });
    } else {
      Object.assign(doc, { lastBump: now, pinned: false, locked: false, postCount: 0, fileCount: doc.files.length });
      await this.db.collection('threads').insertOne(doc);
    }
    return { id, threadId: doc.threadId };
  }
  async rateLimit(identity, operation, limit, windowMs) {
    const slot = Math.floor(Date.now()/windowMs);
    const _id = createHash('sha256').update(`${identity}:${operation}:${slot}`).digest('hex');
    let result;
    try { result = await this.db.collection('chikoRateLimits').findOneAndUpdate({ _id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((slot+2)*windowMs) } }, { upsert: true, returnDocument: 'after' }); }
    catch (error) { if (error.code !== 11000) throw error; return this.rateLimit(identity,operation,limit,windowMs); }
    if (result.count > limit) throw httpError(429, 'Please wait before trying again.');
  }
  async audit(actor, action, boardUri, target, detail = '') {
    await this.db.collection('chikoAudit').insertOne({ _id: randomUUID(), actor: actor?.login || 'anonymous', action, boardUri, target: String(target), detail, at: new Date() });
  }
  async setThread(actor, board, threadId, flag, enabled) {
    if (!this.can(actor,board,'thread')) throw httpError(403,'Permission denied.');
    if (!['locked','pinned'].includes(flag) || !await this.thread(board.boardUri,threadId)) throw httpError(404,'Thread not found.');
    await this.db.collection('chikoThreadState').updateOne({ _id:key(board.boardUri,threadId) }, { $set: { boardUri:board.boardUri,threadId,[flag]:enabled } }, { upsert:true });
    await this.audit(actor,flag,board.boardUri,threadId,String(enabled));
  }
  async removePost(actor, board, postId, reason, authorizedByPassword = false) {
    if (!authorizedByPassword && !this.can(actor,board,'delete')) throw httpError(403,'Permission denied.');
    if (!await this.post(board.boardUri,postId)) throw httpError(404,'Post not found.');
    await this.db.collection('chikoRemovals').updateOne({ _id:key(board.boardUri,postId) }, { $set:{boardUri:board.boardUri,postId,active:true,reason,at:new Date(),actor:actor?.login || 'post author'} },{upsert:true});
    await this.audit(actor,'hide',board.boardUri,postId,reason);
  }
  async banned(identity, boardUri) {
    const now = new Date();
    if (await this.db.collection('chikoBans').findOne({ identity, active:true, $or:[{boardUri:''},{boardUri}], $and:[{$or:[{expiresAt:null},{expiresAt:{$gt:now}}]}] })) return true;
    return false;
  }
  async sourceSnapshot() {
    const rows=[];
    for (const {name} of await this.db.listCollections().toArray()) {
      if (name.startsWith('chiko') && !['chikoIdMap','chikoMigrationRuns'].includes(name)) continue;
      const hash=createHash('sha256');let count=0;
      for await (const doc of this.db.collection(name).find({}, {raw:true}).sort({_id:1})) {hash.update(doc);count++;}
      rows.push({name,count,sha256:hash.digest('hex')});
    }
    return rows.sort((a,b)=>a.name.localeCompare(b.name));
  }
}

module.exports = { CompatibleStore, BOARD, key };
