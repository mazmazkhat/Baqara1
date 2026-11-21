import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export const SESSION_COOKIE = 'bf_session';
export const SESSION_DAYS = 180; // family devices stay signed in; PIN is rarely re-typed
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const MAX_FAILED_BEFORE_LOCK = 5;

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export function hashPin(pin) {
  const salt = randomBytes(16);
  const key = scryptSync(pin, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPin(pin, stored) {
  if (!stored || typeof pin !== 'string') return false;
  const [alg, n, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = scryptSync(pin, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
  return timingSafeEqual(key, expected);
}

/** Returns an error code string, or null when the PIN is acceptable. */
export function pinProblem(pin, { minLength = 4 } = {}) {
  if (typeof pin !== 'string' || !/^\d+$/.test(pin)) return 'pin_digits';
  if (pin.length < minLength || pin.length > 6) return minLength === 6 ? 'pin_length_admin' : 'pin_length';
  if (/^(\d)\1+$/.test(pin)) return 'pin_too_simple';
  const asc = '0123456789012345';
  const desc = '9876543210987654';
  if (asc.includes(pin) || desc.includes(pin)) return 'pin_too_simple';
  return null;
}

export function loginNameProblem(name) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(name)) return 'login_name_format';
  return null;
}

/** Tiny in-memory limiter for failed logins per IP (account lockout is stored in the DB). */
export class IpLimiter {
  constructor({ max = 20, windowMs = 15 * 60 * 1000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  blocked(ip, now) {
    const h = this.hits.get(ip);
    if (!h || now - h.start > this.windowMs) return false;
    return h.count >= this.max;
  }
  fail(ip, now) {
    const h = this.hits.get(ip);
    if (!h || now - h.start > this.windowMs) this.hits.set(ip, { start: now, count: 1 });
    else h.count++;
  }
  reset(ip) {
    this.hits.delete(ip);
  }
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
