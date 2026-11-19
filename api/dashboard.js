import { randomBytes } from 'node:crypto';
import { page } from '../lib/dashboard-view.js';
import { protect, securityHeaders } from '../lib/security.js';

export default async function handler(req, res) {
  const nonce = randomBytes(18).toString('base64');
  securityHeaders(res, nonce);
  if (req.method !== 'GET') return res.status(405).end();
  const admin = await protect(req, res, {
    nonce, onUnauthenticated: () => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(401).end(page(nonce, false));
    }
  });
  if (!admin) return;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).end(page(nonce, true));
}
