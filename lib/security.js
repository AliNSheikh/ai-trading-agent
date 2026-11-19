import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readData, scoped, update } from './store.js';

const derive = promisify(scrypt);
const hashPattern = /^[0-9a-f]{32}:[0-9a-f]{64}$/;
const tokenPattern = /^[a-f0-9]{64}$/;
const COOKIE = '__Host-trading-session';
const TTL = 45 * 60 * 1000;
const initial = () => ({ version: 1, sessions: {}, attempts: {}, events: [] });
const rate = new Map();

export function secretEqual(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length === b.length &&
    timingSafeEqual(Buffer.from(a, 'utf16le'), Buffer.from(b, 'utf16le'));
}

function authStore(change) {
  return update(scoped('auth.json'), initial, data => {
    if (data?.version !== 1 || !data.sessions || !data.attempts || !Array.isArray(data.events)) {
      throw Error('Invalid auth store');
    }
    return change(data);
  });
}

function digest(value) {
  return createHmac('sha256', process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD_HASH)
    .update(value).digest('hex');
}

function client(req) {
  return String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown').slice(0, 96);
}

export function securityHeaders(res, nonce) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" +
    (nonce ? "; connect-src 'self'; script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'" : ''));
}

export function sameOrigin(req) {
  const host = req.headers.host;
  if (typeof host !== 'string' || !/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return false;
  const scheme = process.env.VERCEL ? 'https' : /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https';
  return req.headers.origin === scheme + '://' + host && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin');
}

function allowLocal(key, limit) {
  const now = Date.now();
  if (rate.size >= 2048) {
    for (const [id, value] of rate) if (value.until <= now) rate.delete(id);
    if (rate.size >= 2048 && !rate.has(key)) return false;
  }
  const current = rate.get(key);
  if (!current || current.until <= now) {
    rate.set(key, { until: now + 60000, count: 1 });
    return true;
  }
  return ++current.count <= limit;
}

export async function checkPassword(password, hash) {
  if (!hashPattern.test(hash ?? '') || typeof password !== 'string' || password.length > 512) return false;
  const [salt, expected] = hash.split(':');
  const digest = await derive(password, salt, 32);
  return timingSafeEqual(digest, Buffer.from(expected, 'hex'));
}

export function adminConfigured() {
  return hashPattern.test(process.env.ADMIN_PASSWORD_HASH ?? '');
}

const cookieValue = (token, seconds) => COOKIE + '=' + token + '; Path=/; Max-Age=' + seconds + '; Secure; HttpOnly; SameSite=Strict';

function auditAuth(data, event) {
  data.events = [...data.events.slice(-199), { time: new Date().toISOString(), ...event }];
}

export async function login(req, res, password) {
  if (!adminConfigured()) return res.status(503).json({ error: 'Administrator setup required' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Origin rejected' });
  if (typeof password !== 'string' || !password || password.length > 512) return res.status(400).json({ error: 'Invalid sign-in request' });
  if (!allowLocal('login:' + client(req), 8)) return res.status(429).json({ error: 'Sign-in rate limit reached' });
  const now = Date.now();
  const key = digest('ip:' + client(req));
  const allowed = await authStore(data => {
    for (const [id, interval] of Object.entries(data.attempts)) {
      if (interval.until <= now) delete data.attempts[id];
    }
    const ip = data.attempts[key] ?? { until: now + 900000, count: 0 };
    const global = data.attempts.global ?? { until: now + 900000, count: 0 };
    if (ip.count >= 6 || global.count >= 40) return { unchanged: true, value: false };
    ip.count++;
    global.count++;
    data.attempts[key] = ip;
    data.attempts.global = global;
    return true;
  });
  if (!allowed) return res.status(429).json({ error: 'Sign-in rate limit reached' });

  const valid = await checkPassword(password, process.env.ADMIN_PASSWORD_HASH);
  const token = randomBytes(32).toString('hex');
  await authStore(data => {
    for (const [id, session] of Object.entries(data.sessions)) if (session.expires <= now) delete data.sessions[id];
    auditAuth(data, { action: valid ? 'login' : 'login-rejected', client: key.slice(0, 16) });
    if (valid) data.sessions[digest(token)] = { expires: now + TTL };
  });
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  res.setHeader('Set-Cookie', cookieValue(token, TTL / 1000));
  return res.json({ authenticated: true });
}

export async function protect(req, res, { mutation = false, nonce, onUnauthenticated } = {}) {
  securityHeaders(res, nonce);
  if (!adminConfigured()) {
    res.status(503).json({ error: 'Administrator setup required' });
    return null;
  }
  if (!allowLocal('api:' + client(req), 90)) {
    res.status(429).json({ error: 'Request rate limit reached' });
    return null;
  }
  const tokens = String(req.headers.cookie || '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(COOKIE + '='));
  const token = tokens.length === 1 ? tokens[0].slice(COOKIE.length + 1) : '';
  if (tokenPattern.test(token)) {
    const id = digest(token);
    try {
      const auth = await readData(scoped('auth.json'));
      const session = auth?.version === 1 && auth.sessions?.[id];
      if (session?.expires > Date.now()) {
        const csrf = digest('csrf:' + token);
        if (mutation && (!sameOrigin(req) || !secretEqual(req.headers['x-csrf-token'], csrf))) {
          res.status(403).json({ error: 'Mutation authorization rejected' });
          return null;
        }
        return { id, csrf };
      }
    } catch {
      res.status(503).json({ error: 'Session store unavailable' });
      return null;
    }
  }
  if (onUnauthenticated) onUnauthenticated();
  else res.status(401).json({ error: 'Authentication required' });
  return null;
}

export async function logout(res, id) {
  await authStore(data => {
    delete data.sessions[id];
    auditAuth(data, { action: 'logout', session: id.slice(0, 16) });
  });
  res.setHeader('Set-Cookie', cookieValue('', 0));
  return res.json({ authenticated: false });
}

export function jsonBody(req) {
  if (typeof req.headers['content-type'] !== 'string' ||
      req.headers['content-type'].split(';')[0].trim() !== 'application/json') throw Error('JSON content required');
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const serialized = JSON.stringify(body);
  if (!body || Array.isArray(body) || typeof body !== 'object' || Buffer.byteLength(serialized) > 8000) {
    throw Error('Invalid request body');
  }
  return body;
}
