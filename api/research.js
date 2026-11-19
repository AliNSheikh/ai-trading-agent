import { protect } from '../lib/security.js';
import { getState, history } from '../lib/store.js';

export default async function handler(req, res) {
  if (!await protect(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();
  const kind = req.query?.kind === 'audit' ? 'audit' : 'runs';
  try {
    const state = await getState();
    const head = kind === 'audit' ? state.auditHead : state.head;
    const cursor = req.query?.cursor;
    if (cursor && (typeof cursor !== 'string' || !/^[a-f0-9-]{36}$/.test(cursor))) {
      return res.status(400).json({ error: 'Invalid journal cursor' });
    }
    return res.json({ mode: 'binance-demo-spot', ...await history(kind, cursor || head, 5) });
  } catch {
    return res.status(503).json({ error: 'Demo journal unavailable' });
  }
}
