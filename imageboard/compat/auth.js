'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { parseCookies, timingSafeEqualStrings } = require('../lib/utils');
const pbkdf2 = promisify(crypto.pbkdf2);
const scrypt = promisify(crypto.scrypt);

async function passwordHash(password) {
  const salt = crypto.randomBytes(24).toString('base64url');
  const hash = await scrypt(String(password), salt, 32);
  return `chiko-scrypt-v1$${salt}$${hash.toString('base64url')}`;
}

// Verify the documented source algorithm. Never rewrite a source credential.
async function passwordMatches(user, password) {
  if (!user || typeof password !== 'string' || password.length > 1024) return false;
  if (user.chikoLegacyScryptHash) {
    const [method,saltText,digestText,extra]=String(user.chikoLegacyScryptHash).split('$');
    if(method!=='scrypt'||extra||!saltText||!digestText)return false;
    const salt=Buffer.from(saltText,'base64url'),expected=Buffer.from(digestText,'base64url');
    if(salt.length!==16||expected.length!==32)return false;
    return timingSafeEqualStrings((await scrypt(password,salt,32)).toString('base64url'),digestText);
  }
  if (user.chikoPasswordHash) {
    const [method, salt, encoded] = String(user.chikoPasswordHash).split('$');
    if (method !== 'chiko-scrypt-v1' || !salt || !encoded) return false;
    return timingSafeEqualStrings((await scrypt(password, salt, 32)).toString('base64url'), encoded);
  }
  const iterations = user.passwordMethod === 'pbkdf2' ? 4096 : user.passwordMethod === 'pbkdf2V2' ? 16384 : 0;
  if (!iterations || typeof user.passwordSalt !== 'string' || typeof user.password !== 'string') return false;
  const candidate = await pbkdf2(password, user.passwordSalt, iterations, 256, 'sha512');
  return timingSafeEqualStrings(candidate.toString('base64'), user.password);
}

class Sessions {
  constructor(secret, secure = true) { this.secret = secret; this.secure = secure; this.cookie = secure ? '__Host-chikochan' : 'chikochan_dev'; }
  sign(value) { return crypto.createHmac('sha256', this.secret).update(value).digest('base64url'); }
  issue(login, version = 0) {
    const body = Buffer.from(JSON.stringify({ login, version, exp: Date.now() + 8 * 3600000, nonce: crypto.randomBytes(24).toString('base64url') })).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }
  read(request) {
    try {
      const token = parseCookies(request.headers.cookie)[this.cookie] || '';
      const [body, signature, extra] = token.split('.');
      if (!body || !signature || extra || !timingSafeEqualStrings(signature, this.sign(body))) return null;
      const value = JSON.parse(Buffer.from(body, 'base64url').toString());
      return value.exp > Date.now() && typeof value.login === 'string' && typeof value.nonce === 'string' ? value : null;
    } catch { return null; }
  }
  set(response, token) {
    response.append('Set-Cookie', `${this.cookie}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? 28800 : 0}${this.secure ? '; Secure' : ''}`);
  }
  csrf(nonce) { return this.sign(`csrf:${nonce}`); }
}

module.exports = { passwordHash, passwordMatches, Sessions };
