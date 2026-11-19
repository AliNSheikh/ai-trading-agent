import { runCycle } from '../lib/cycle.js';
import { integrationHealth } from '../lib/integrations.js';
import { secretEqual, securityHeaders } from '../lib/security.js';

export default async function handler(req, res) {
  securityHeaders(res);
  const secret = process.env.CRON_SECRET;
  const environment = process.env.VERCEL_ENV;
  if (req.method !== 'GET' || !['production', 'preview'].includes(environment) ||
      typeof secret !== 'string' || secret.length < 16 ||
      !secretEqual(req.headers.authorization, 'Bearer ' + secret)) return res.status(401).end();
  try {
    if (req.query?.verify === '1') {
      const deployment = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA;
      if (!/^[-a-zA-Z0-9_]{8,80}$/.test(deployment ?? '')) return res.status(503).json({ error: 'Deployment identity unavailable' });
      const services = await integrationHealth({ verificationId: 'runtime-' + deployment });
      const available = Object.values(services).every(service => service.status === 'connected');
      return res.status(available ? 200 : 503).json({ environment, region: process.env.VERCEL_REGION, services });
    }
    if (environment !== 'production') return res.status(401).end();
    return res.json(await runCycle('schedule'));
  } catch {
    return res.status(503).json({ error: 'Scheduled Demo research unavailable' });
  }
}
