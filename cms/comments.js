import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { clientIpResolver } from '../client-ip.js';
import { id, visible } from './models.js';
import { escapeHtml as e, json, problem, readBody } from './http.js';

const countryCodes = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
const countries = new Set(countryCodes);
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const publicFields = { username: 1, message: 1, website: 1, country: 1, createdAt: 1 };
export const commentVisible = { hidden: { $ne: true }, deletedAt: { $exists: false } };
export function commentHtml(c) {
  const iso = new Date(c.createdAt).toISOString();
  const flag = /^[A-Z]{2}$/.test(c.country || '') ? [...c.country].map(x => String.fromCodePoint(127397 + x.charCodeAt(0))).join('') : '';
  return `<div class="blog-comment" data-comment-id="${c._id}"><div class="comment-content"><div class="comment-meta"><strong>${e(c.username)}</strong>${flag ? `<span title="${e(c.country)}">${flag}</span>` : ''}${c.website ? `<a href="${e(c.website)}" rel="nofollow ugc noopener noreferrer" target="_blank">[${e(new URL(c.website).hostname)}]</a>` : ''}<time datetime="${iso}">${iso.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}</time></div><p>${e(c.message)}</p></div></div>`;
}
export async function commentList(db, blogId, before) {
  const filter = { blogId, ...commentVisible };
  if (before) filter._id = { $lt: id(before) };
  const rows = await db.collection('comments').find(filter, { projection: publicFields }).sort({ _id: -1 }).limit(21).toArray();
  return { comments: rows.slice(0, 20), next: rows.length > 20 ? String(rows[19]._id) : null };
}
export function commentSection(post, rows = { comments: [], next: null }) {
  const key = String(post._id);
  return `<section class="blog-comments" data-blog-id="${key}"><h3>Comments</h3><div class="comment-list">${rows.comments.map(commentHtml).join('')}</div><p class="comments-empty" ${rows.comments.length ? 'hidden' : ''}>No comments yet.</p><button class="comments-more" type="button" ${rows.next ? '' : 'hidden'} data-next="${rows.next || ''}">Load more</button><form class="comment-form"><label>Username<input name="username" required maxlength="40" autocomplete="nickname"></label><label>Website (optional)<input name="website" type="url" maxlength="300" placeholder="https://" autocomplete="url"></label><label>Country (optional)<select name="country"><option value="">No flag</option>${countryCodes.map(code => `<option value="${code}">${e(countryNames.of(code))}</option>`).join('')}</select></label><label class="comment-message">Message<textarea name="message" required maxlength="4000" rows="3"></textarea></label><label class="comment-trap" aria-hidden="true">Leave this empty<input name="company" tabindex="-1" autocomplete="off"></label><input name="token" type="hidden"><button type="submit" disabled>Post comment</button><p class="comment-status" role="status" aria-live="polite">Loading comment form…</p></form></section>`;
}
export function commentRoutes(store, env) {
  const db = store.db;
  const secret = env.SESSION_SECRET;
  const hmac = value => createHmac('sha256', secret).update(value).digest('hex');
  const address = clientIpResolver({ trustedProxies: (env.COMMENT_TRUSTED_PROXIES || env.ADMIN_TRUSTED_PROXIES || '').split(',').filter(Boolean), header: env.COMMENT_IP_HEADER || env.ADMIN_IP_HEADER || 'x-real-ip' });
  const origins = (env.SITE_ORIGIN || '').split(',').filter(Boolean);
  const token = key => { const value = `${key}.${Date.now()}.${randomBytes(16).toString('hex')}`; return `${value}.${hmac(value)}`; };
  async function limit(req) {
    const now = Date.now();
    for (const [key, span, max] of [[hmac(address(req) || 'unknown'), 60000, 3], [hmac(address(req) || 'unknown'), 3600000, 20], ['global', 60000, 100]]) {
      const _id = `${key}:${span}:${Math.floor(now / span)}`;
      let row;
      try { row = await db.collection('commentLimits').findOneAndUpdate({ _id }, { $inc: { attempts: 1 }, $setOnInsert: { expiresAt: new Date(now + span * 2) } }, { upsert: true, returnDocument: 'after' }); }
      catch (error) { if (error.code !== 11000) throw error; row = await db.collection('commentLimits').findOneAndUpdate({ _id }, { $inc: { attempts: 1 } }, { returnDocument: 'after' }); }
      if (row.attempts > max) throw problem(429, 'Too many comments. Please wait before trying again.');
    }
  }
  return async (req, res, path, url) => {
    const blogId = id(path.slice('/api/comments/'.length));
    if (!await db.collection('blogs').findOne({ _id: blogId, ...visible })) throw problem(404, 'Blog post not found.');
    if (req.method === 'GET') return json(res, 200, { ...await commentList(db, blogId, url.searchParams.get('before')), token: token(String(blogId)) });
    if (req.method !== 'POST') throw problem(405, 'Method not allowed.');
    const origin = req.headers.origin;
    if (req.headers['sec-fetch-site'] === 'cross-site' || !(origins.length ? origins.includes(origin) : origin === `http://${req.headers.host}`)) throw problem(403, 'Request origin rejected.');
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw problem(415, 'Use a JSON request.');
    await limit(req);
    let data;
    try { data = JSON.parse((await readBody(req, 16384)).toString('utf8')); } catch (error) { if (error.status) throw error; throw problem(400, 'Invalid comment.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw problem(400, 'Invalid comment.');
    if (Object.hasOwn(data, 'avatar')) throw problem(400, 'Avatar uploads are disabled.');
    const parts = typeof data.token === 'string' && data.token.match(/^([a-f0-9]{24})\.(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/);
    if (!parts || parts[1] !== String(blogId) || !timingSafeEqual(Buffer.from(parts[4], 'hex'), Buffer.from(hmac(parts.slice(1, 4).join('.')), 'hex'))) throw problem(403, 'Reload the comment form and try again.');
    const age = Date.now() - Number(parts[2]);
    if (age < 2000) throw problem(400, 'Please wait a moment before submitting.');
    if (age > 7200000) throw problem(403, 'Your comment form expired. Reload and try again.');
    if (data.company) throw problem(400, 'Unable to accept this comment.');
    const clean = (value, max) => {
      if (typeof value !== 'string' || value.length > max) throw problem(400, `Use at most ${max} characters.`);
      const result = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '').trim();
      if (!result) throw problem(400, 'Username and message cannot be empty.');
      return result;
    };
    const username = clean(data.username, 40), message = clean(data.message, 4000);
    if ((message.match(/https?:\/\//gi) || []).length > 5) throw problem(400, 'Please use fewer links in your comment.');
    let website = '';
    if (data.website) {
      if (typeof data.website !== 'string' || data.website.length > 300) throw problem(400, 'Website URL is too long.');
      try { const u = new URL(data.website.trim()); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw new Error(); website = u.href; }
      catch { throw problem(400, 'Use an HTTP or HTTPS website URL.'); }
    }
    const country = typeof data.country === 'string' ? data.country.trim().toUpperCase() : '';
    if (country && !countries.has(country)) throw problem(400, 'Choose a valid country or no flag.');
    // A unique digest blocks repeat submissions, including network retries.
    const digest = hmac(`${blogId}\0${username}\0${message}`);
    const record = { _id: new ObjectId(), blogId, username, message, website, country, createdAt: new Date(), digest, hidden: env.COMMENTS_REQUIRE_APPROVAL === 'true' };
    try { await db.collection('comments').insertOne(record); }
    catch (error) { if (error.code === 11000) throw problem(409, 'This comment has already been submitted.'); throw error; }
    return json(res, 201, { comment: record.hidden ? null : Object.fromEntries(['_id', ...Object.keys(publicFields)].filter(key => key in record).map(key => [key, record[key]])), pending: record.hidden, token: token(String(blogId)) });
  };
}
