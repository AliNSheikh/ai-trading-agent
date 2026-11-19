import { protect } from '../lib/security.js';
import { integrationHealth } from '../lib/integrations.js';

export default async function handler(req, res) {
  if (!await protect(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();
  return res.json({ mode: 'binance-demo-spot', services: await integrationHealth() });
}
