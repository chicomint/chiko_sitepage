'use strict';

const { escapeHTML:e, formatBytes } = require('../lib/utils');
const enc=encodeURIComponent;
const url=(b,t)=>`/${enc(b)}/res/${t}.html`;
function markup(message,boardUri) {
  return e(String(message || '')).replace(/&gt;&gt;&gt;\/([A-Za-z0-9_-]+)\/(\d+)/g,(_m,b,n)=>`<a href="/${enc(b)}/post/${n}">&gt;&gt;&gt;/${e(b)}/${n}</a>`)
    .replace(/(?<![A-Za-z0-9/])&gt;&gt;(\d+)/g,(_m,n)=>`<a class="quote" href="/${enc(boardUri)}/post/${n}">&gt;&gt;${n}</a>`)
    .split('\n').map(line=>line.startsWith('&gt;')?`<span class="greentext">${line}</span>`:line).join('<br>');
}
function csrf(req) { return `<input type="hidden" name="csrf" value="${e(req.csrf)}">`; }
function layout(title,content,{boards=[],user=null,readonly=false,board=null}={}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${e(title)} · ChikoChan</title><link rel="stylesheet" href="/assets/chiko.css"><script defer src="/assets/chiko.js"></script></head><body data-accent="${e(['rose','blue','green'].includes(board?.chikoTheme)?board.chikoTheme:'rose')}"><header><a class="brand" href="/">Chiko<span>Chan</span></a><nav><a href="/boards">Boards</a><a href="/admin">${user?e(user.login):'Staff login'}</a><button id="theme" type="button">Theme</button></nav></header><nav class="board-nav">${boards.map(b=>`<a href="/${enc(b.boardUri)}/">/${e(b.boardUri)}/</a>`).join(' ')}</nav>${readonly?'<p class="notice">Migration preview · posting is disabled.</p>':''}<main>${content}</main><footer>ChikoChan · A place to share, discuss, and create. <a href="/boards">Find a board</a></footer></body></html>`;
}
function form(req,board,threadId,siteKey='') {
  const b=enc(board.boardUri);
  return `<details class="compose" ${threadId?'open':''}><summary>${threadId?'Reply to this thread':'Start a thread'}</summary><form action="/${b}/post?nativeChallenge=${enc(req.challenge?.token || '')}" method="post" enctype="multipart/form-data">${csrf(req)}${threadId?`<input type="hidden" name="threadId" value="${threadId}">`:''}<div class="form-grid"><label>Name<input name="name" maxlength="80" placeholder="${e(board.anonymousName || 'Anonymous')}"></label><label>Subject<input name="subject" maxlength="120"></label></div><label>Message<textarea id="message" name="message" maxlength="16000" rows="5" required></textarea></label><div class="form-grid"><label>Attachments<input type="file" name="files" accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm" multiple></label><label>Deletion password<input type="password" name="password" maxlength="200" autocomplete="new-password"></label></div><label class="honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><label><input type="checkbox" name="sage" value="1"> Reply without bumping</label>${req.challenge?`<label>Enter the six digits<img class="captcha" src="${req.challenge.image}" alt="Verification digits"><input name="nativeAnswer" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required></label>`:''}<p class="hint">Up to 4 files, 25 MB each. Use &gt;&gt;123 to reference a post. Name#secret creates a tripcode.</p><button type="submit">${threadId?'Post reply':'Create thread'}</button></form></details>`;
}
function attachments(files=[]) {
  return `<div class="attachments">${files.map(f=>{
    const safe=/^\/(?:\.media\/|media\/)[A-Za-z0-9_.-]+$/.test(f.path || '');
    const thumb=/^\/(?:\.media\/|media\/)[A-Za-z0-9_.-]+$/.test(f.thumb || '');
    if(!safe)return '<p>Attachment requires a verified storage mapping.</p>';
    return `<figure><figcaption><a href="${e(f.path)}">${e(f.originalName || 'Attachment')}</a> <small>${formatBytes(f.size)}</small></figcaption>${String(f.mime).startsWith('video/')?`<video controls preload="none" ${thumb?`poster="${e(f.thumb)}"`:''} src="${e(f.path)}"></video>`:`<a href="${e(f.path)}"><img loading="lazy" src="${e(thumb?f.thumb:f.path)}" alt="${e(f.originalName || 'Attachment')}"></a>`}</figure>`;
  }).join('')}</div>`;
}
function post(p,thread,req,moderator=false,opening=false) {
  const id=opening?thread.threadId:p.postId;
  const nativeId=Number(p._chikoMigration?.oldId);
  const legacyAnchors=Number.isSafeInteger(nativeId)&&nativeId>0?`<span id="p${nativeId}" aria-hidden="true"></span><span id="m${nativeId}" aria-hidden="true"></span>`:'';
  return `<article class="post ${opening?'opening':''}" id="${id}">${legacyAnchors}<div class="post-meta"><strong>${e(p.subject)}</strong> <span class="name">${e(p.name || 'Anonymous')}</span> <span class="trip">${e(p.tripcode || '')}</span> <time datetime="${new Date(p.creation || 0).toISOString()}">${e(new Date(p.creation || 0).toLocaleString('en-GB',{timeZone:'UTC'}))} UTC</time> <a href="${url(thread.boardUri,thread.threadId)}#${id}">No.${id}</a> <button class="quote-button" data-quote="${id}" type="button">Quote</button>${opening&&thread.pinned?' <b>Pinned</b>':''}${opening&&thread.locked?' <b>Locked</b>':''}</div>${attachments(p.files)}<div class="message">${markup(p.message,thread.boardUri)}</div><details class="post-actions"><summary>Report / delete${moderator?' / moderate':''}</summary><form class="inline" method="post" action="/${enc(thread.boardUri)}/report">${csrf(req)}<input type="hidden" name="postId" value="${id}"><label>Report reason<input name="reason" maxlength="1000" required></label><button>Report</button></form><form class="inline" method="post" action="/${enc(thread.boardUri)}/delete">${csrf(req)}<input type="hidden" name="postId" value="${id}"><label>Deletion password<input type="password" name="password" maxlength="200"></label><button>Delete post</button></form>${moderator?`<form class="inline" method="post" action="/admin/action">${csrf(req)}<input type="hidden" name="boardUri" value="${e(thread.boardUri)}"><input type="hidden" name="postId" value="${id}"><input type="hidden" name="threadId" value="${thread.threadId}"><label>Action<select name="action"><option value="hide">Hide post</option><option value="ban">Ban this poster</option>${opening?`<option value="${thread.locked?'unlock':'lock'}">${thread.locked?'Unlock':'Lock'} thread</option><option value="${thread.pinned?'unpin':'pin'}">${thread.pinned?'Unpin':'Pin'} thread</option>`:''}</select></label><label>Reason<input name="reason" maxlength="1000" required></label><button>Apply</button></form>`:''}</details></article>`;
}
function thread(t,req,moderator=false,full=false) {
  return `<section class="thread">${post(t,t,req,moderator,true)}${!full?`<a class="reply-link" href="${url(t.boardUri,t.threadId)}">Open thread · ${t.replyCount} replies</a>`:''}${t.replies.map(p=>post(p,t,req,moderator)).join('')}</section>`;
}
module.exports={e,enc,url,markup,csrf,layout,form,attachments,post,thread};
