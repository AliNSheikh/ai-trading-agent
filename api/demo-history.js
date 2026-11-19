import { protect } from '../lib/security.js';
import { demo } from '../lib/demo.js';
import { pairs } from '../lib/settings.js';

export default async function handler(req, res) {
  if (!await protect(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const groups = await Promise.all(pairs.map(async symbol => {
      const [orders, fills] = await Promise.all([
        demo('/api/v3/allOrders', { symbol, limit: 50 }, true),
        demo('/api/v3/myTrades', { symbol, limit: 500 }, true)
      ]);
      return orders.map(order => {
        const quantity = Number(order.executedQty);
        const total = Number(order.cummulativeQuoteQty);
        const associated = fills.filter(fill => fill.orderId === order.orderId);
        const fees = {};
        for (const fill of associated) {
          if (/^[A-Z0-9]{1,16}$/.test(fill.commissionAsset)) {
            fees[fill.commissionAsset] = (fees[fill.commissionAsset] ?? 0) + Number(fill.commission);
          }
        }
        return {
          symbol, orderId: order.orderId, side: order.side, status: order.status, quantity, total,
          price: quantity > 0 ? total / quantity : null, time: new Date(order.time).toISOString(),
          fillCoverage: Math.abs(associated.reduce((sum, fill) => sum + Number(fill.qty), 0) - quantity) < 1e-8,
          fees, origin: /^ta-[a-f0-9]{28}$/.test(order.clientOrderId) ? 'Platform client ID' : 'External Demo order'
        };
      });
    }));
    return res.json({ mode: 'binance-demo-spot', orders: groups.flat().sort((a, b) => b.time.localeCompare(a.time)) });
  } catch {
    return res.status(503).json({ error: 'Binance Demo account history unavailable' });
  }
}
