import { runCycle } from '../lib/cycle.js';
import { secretEqual, securityHeaders } from '../lib/security.js';

export default async function handler(req, res) {
  securityHeaders(res);
  const secret = process.env.CRON_SECRET;
  if (req.method !== 'GET' || process.env.VERCEL_ENV !== 'production' ||
      typeof secret !== 'string' || secret.length < 16 ||
      !secretEqual(req.headers.authorization, 'Bearer ' + secret)) return res.status(401).end();
  try {
    return res.json(await runCycle('schedule'));
  } catch {
    return res.status(503).json({ error: 'Scheduled Demo research unavailable' });
  }
}
