import { jsonBody, login, logout, protect, securityHeaders } from '../lib/security.js';

export default async function handler(req, res) {
  securityHeaders(res);
  if (req.method !== 'POST') return res.status(405).end();
  let body;
  try { body = jsonBody(req); }
  catch { return res.status(400).json({ error: 'Invalid sign-in request' }); }
  try {
    if (body.action === 'login') return await login(req, res, body.password);
    if (body.action === 'logout') {
      const admin = await protect(req, res, { mutation: true });
      if (admin) return await logout(res, admin.id);
      return;
    }
    return res.status(400).json({ error: 'Invalid session operation' });
  } catch {
    return res.status(503).json({ error: 'Session service unavailable' });
  }
}
