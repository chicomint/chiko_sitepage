import { randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { problem } from './http.js';
import { clientIpResolver } from '../client-ip.js';
const digest = value => createHash('sha256').update(String(value)).digest();
const equal = (a, b) => timingSafeEqual(digest(a), digest(b));
export function createAuth(db, env = process.env) {
  const { ADMIN_USERNAME: username, ADMIN_PASSWORD: password, ADMIN_PASSWORD_HASH: passwordHash, SESSION_SECRET: secret } = env;
  if (!username || (!password && !passwordHash) || !secret || secret.length < 32) throw new Error('Configure ADMIN_USERNAME, ADMIN_PASSWORD_HASH or ADMIN_PASSWORD, and SESSION_SECRET (at least 32 characters).');
  if (passwordHash && !/^\$2[aby]\$(1[0-6])\$[./A-Za-z0-9]{53}$/.test(passwordHash)) throw new Error('ADMIN_PASSWORD_HASH must be a bcrypt hash with cost 10–16.');
  const production = env.NODE_ENV === 'production';
  const cookieName = production ? '__Host-chicomint_admin' : 'chicomint_admin';
  const ttl = 8 * 60 * 60 * 1000;
  const sessions = db.collection('sessions');
  const hmac = value => createHmac('sha256', secret).update(value).digest('hex');
  const credentialsVersion = hmac(username + '\0' + (passwordHash || password));
  const address = clientIpResolver({ trustedProxies: (env.ADMIN_TRUSTED_PROXIES || '').split(',').filter(Boolean), header: env.ADMIN_IP_HEADER || 'x-real-ip' });
  const origins = (env.SITE_ORIGIN || '').split(',').filter(Boolean);
  if (production && (!origins.length || origins.some(o => { try { return new URL(o).origin !== o || !o.startsWith('https://'); } catch { return true; } }))) throw new Error('SITE_ORIGIN must contain canonical HTTPS origins in production.');
  function cookie(res, value, age) { res.setHeader('Set-Cookie', `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${production ? '; Secure' : ''}`); }
  async function get(req) {
    const raw = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!raw || !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(raw)) return null;
    const [token, signature] = raw.split('.');
    if (!equal(signature, hmac(token))) return null;
    return sessions.findOne({ _id: hmac(token), expiresAt: { $gt: new Date() }, credentialsVersion });
  }
  async function issue(res, authenticated = false) {
    const token = randomBytes(32).toString('hex');
    const age = authenticated ? ttl : 15 * 60 * 1000;
    const session = { _id: hmac(token), csrf: randomBytes(32).toString('hex'), authenticated, credentialsVersion, expiresAt: new Date(Date.now() + age) };
    await sessions.insertOne(session); cookie(res, token + '.' + hmac(token), age / 1000); return session;
  }
  function csrf(req, session, token) {
    if (!session || typeof token !== 'string' || !equal(token, session.csrf)) throw problem(403, 'Your form expired. Reload the page and try again.');
    const origin = req.headers.origin;
    const allowed = origins.length ? origins.includes(origin) : !production && origin === `http://${req.headers.host}`;
    if (origin && !allowed) throw problem(403, 'Request origin rejected.');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw problem(403, 'Cross-site request rejected.');
  }
  async function limit(req, login = true) {
    // Fixed windows in MongoDB work across restarts and multiple server instances.
    const now = Date.now(), span = login ? 15 * 60 * 1000 : 60000;
    const keys = login ? [[hmac(address(req) || 'unknown'), 10], ['global-login', 100]] : [[hmac(address(req) || 'unknown') + '-form', 60]];
    for (const [key, max] of keys) {
      const _id = `${key}:${Math.floor(now / span)}`;
      let row;
      try { row = await db.collection('loginLimits').findOneAndUpdate({ _id }, { $inc: { attempts: 1 }, $setOnInsert: { expiresAt: new Date(now + span * 2) } }, { upsert: true, returnDocument: 'after' }); }
      catch (error) { if (error.code !== 11000) throw error; row = await db.collection('loginLimits').findOneAndUpdate({ _id }, { $inc: { attempts: 1 } }, { returnDocument: 'after' }); }
      if (row.attempts > max) throw problem(429, 'Too many attempts. Try again in 15 minutes.');
    }
  }
  async function login(req, res, session, data) {
    await limit(req);
    csrf(req, session, data.csrf);
    if (typeof data.username !== 'string' || typeof data.password !== 'string' || data.password.length > 1024 || data.username.length > 200) throw problem(401, 'Incorrect username or password.');
    const passwordOK = passwordHash ? await bcrypt.compare(data.password, passwordHash) : equal(data.password, password);
    if (!equal(data.username, username) || !passwordOK) throw problem(401, 'Incorrect username or password.');
    await sessions.deleteOne({ _id: session._id });
    return issue(res, true);
  }
  async function logout(res, session) { if (session) await sessions.deleteOne({ _id: session._id }); cookie(res, '', 0); }
  return { get, issue, csrf, login, logout, limit };
}
