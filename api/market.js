import { chartCandles } from '../lib/demo.js';
import { pairs } from '../lib/settings.js';
import { protect } from '../lib/security.js';

const ranges = new Map([
  ['1D', ['15m', 96]], ['1W', ['1h', 168]], ['1M', ['4h', 180]], ['3M', ['1d', 90]]
]);

export default async function handler(req, res) {
  if (!await protect(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();
  const { symbol, range = '1D' } = req.query ?? {};
  if (!pairs.includes(symbol) || !ranges.has(range)) return res.status(400).json({ error: 'Invalid chart pair or time range' });
  const [interval, limit] = ranges.get(range);
  try {
    const bars = await chartCandles(symbol, interval, limit);
    if (bars.length < 2) throw Error('Insufficient Demo candles');
    return res.json({ symbol, range, interval, source: 'Binance Demo Spot', bars });
  } catch {
    return res.status(503).json({ error: 'Demo market chart unavailable' });
  }
}
