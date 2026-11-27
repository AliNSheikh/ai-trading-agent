import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fingerprint } from '../../lib/orders.js';
import { multiStrategyMigration, defaults } from '../../lib/settings.js';

const etag = data => createHash('sha1').update(JSON.stringify(data)).digest('hex');
const storeRoot = '/repos/AliNSheikh/ai-trading-data/contents/';
export const SHA = 'b'.repeat(40);

export function install(t, { seed = {}, price = 100 } = {}) {
  const env = { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: SHA, DEMO_EXECUTION_ENABLED: 'true', DEMO_AUTONOMOUS_ENABLED: 'true', DEMO_BRACKET_ENABLED: 'true',
    DEMO_ENGINE_EXECUTION: 'true', GITHUB_DATA_TOKEN: 'fixture', BINANCE_DEMO_API_KEY: 'fixture-key', BINANCE_DEMO_API_SECRET: 'fixture-secret',
    ADMIN_PASSWORD_HASH: 'c'.repeat(32) + ':' + 'd'.repeat(64) };
  const old = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  t.after(() => { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  const files = new Map();
  const now = Date.now();
  const settings = multiStrategyMigration({ ...defaults, pairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT'], capital: 1000, maxTrades: 3, maxOpenPositions: 2,
    maxPosition: { mode: 'usd', value: 10 }, dailyVolume: { mode: 'percent', value: 20 }, riskPerTrade: { mode: 'percent', value: 1.5 }, dailyLoss: { mode: 'percent', value: 2 }, monthlyLoss: { mode: 'percent', value: 10 } });
  files.set('v1/production/state.json', { schema: 1, settings, strategy: { id: 's' }, stopped: false, verification: { fingerprint: fingerprint(), checkedAt: now, expires: now + 86400000 },
    lease: { id: 'L1', until: now + 240000 }, pending: null, positions: {}, days: {}, months: {}, realized: 0, ai: {}, operations: {}, latest: {}, lastScheduled: {}, book: {}, ...seed });

  const x = { price, calls: [], lists: {}, orders: {}, nextId: 100, listSeq: 1, failSellPost: false, expireEntry: false, balances: { USDT: 1000 } };
  x.state = () => files.get('v1/production/state.json');
  const orderOf = (id) => x.orders[id];
  const byClient = cid => Object.values(x.orders).find(o => o.clientOrderId === cid);
  x.hit = (listId, leg) => {   // trigger an exchange-side stop or target
    const l = x.lists[listId], sell = l.orders.map(orderOf).find(o => o.side === 'SELL' && o.kind === leg);
    const px = leg === 'target' ? Number(sell.price) : Number(sell.stopPrice);
    sell.status = 'FILLED'; sell.executedQty = l.qty; sell.cummulativeQuoteQty = String(px * Number(l.qty)); sell.updateTime = Date.now(); sell.fillPrice = px;
    for (const id of l.orders) { const o = orderOf(id); if (o.side === 'SELL' && o !== sell) { o.status = 'CANCELED'; o.executedQty = '0'; o.cummulativeQuoteQty = '0'; } }
    l.status = 'ALL_DONE';
  };
  const json = (b, s = 200) => Response.json(b, { status: s });
  const err = (code, msg, s = 400) => json({ code, msg }, s);

  t.mock.method(globalThis, 'fetch', async (address, options = {}) => {
    const url = new URL(address), p = url.pathname, q = url.searchParams, m = options.method ?? 'GET';
    if (url.origin === 'https://api.github.com') {
      const path = p.slice(storeRoot.length), cur = files.get(path);
      if (m === 'PUT') {
        const body = JSON.parse(options.body);
        if (cur && etag(cur) !== body.sha || !cur && body.sha) return new Response(null, { status: 409 });
        files.set(path, JSON.parse(Buffer.from(body.content, 'base64'))); return json({});
      }
      if (!cur) return new Response(null, { status: 404 });
      return json({ type: 'file', encoding: 'base64', sha: etag(cur), content: Buffer.from(JSON.stringify(cur)).toString('base64') });
    }
    assert.equal(url.origin, 'https://demo-api.binance.com');
    x.calls.push(m + ' ' + p);
    const symbol = q.get('symbol'), base = symbol?.replace(/USDT$/, '');
    if (p === '/api/v3/account') return json({ accountType: 'SPOT', canTrade: true, commissionRates: { taker: '0.001', buyer: '0' },
      balances: [{ asset: 'USDT', free: String(x.balances.USDT) }, ...Object.entries(x.balances).filter(([a]) => a !== 'USDT').map(([asset, free]) => ({ asset, free: String(free) }))] });
    if (p === '/api/v3/exchangeInfo') return json({ symbols: [{ symbol, baseAsset: base, quoteAsset: 'USDT', status: 'TRADING', isSpotTradingAllowed: true, quoteOrderQtyMarketAllowed: true,
      otoAllowed: true, opoAllowed: true, ocoAllowed: true, orderTypes: ['MARKET', 'LIMIT'],
      filters: [{ filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001', maxQty: '100000' }, { filterType: 'NOTIONAL', applyMinToMarket: true, minNotional: '5' },
        { filterType: 'PRICE_FILTER', tickSize: '0.01' }] }] });
    if (p === '/api/v3/ticker/bookTicker') return json({ symbol, bidPrice: (x.price - 0.05).toFixed(2), askPrice: x.price.toFixed(2) });
    if (p === '/api/v3/order/test') return json({});
    if (p === '/api/v3/orderList/opoco' && m === 'POST') {
      const lid = q.get('listClientOrderId'), qty = q.get('workingQuantity'), wp = q.get('workingPrice');
      const ids = [x.nextId++, x.nextId++, x.nextId++];
      const filled = !x.expireEntry;
      x.orders[ids[0]] = { orderId: ids[0], symbol, side: 'BUY', type: 'LIMIT', clientOrderId: q.get('workingClientOrderId'), status: filled ? 'FILLED' : 'EXPIRED',
        executedQty: filled ? qty : '0', cummulativeQuoteQty: filled ? String(Number(qty) * Number(wp)) : '0', price: wp, updateTime: Date.now(), kind: 'entry' };
      x.orders[ids[1]] = { orderId: ids[1], symbol, side: 'SELL', type: 'LIMIT_MAKER', clientOrderId: 'x' + ids[1], status: filled ? 'NEW' : 'EXPIRED', executedQty: '0', cummulativeQuoteQty: '0', price: q.get('pendingAbovePrice'), kind: 'target', updateTime: Date.now() };
      x.orders[ids[2]] = { orderId: ids[2], symbol, side: 'SELL', type: 'STOP_LOSS', clientOrderId: 'y' + ids[2], status: filled ? 'NEW' : 'EXPIRED', executedQty: '0', cummulativeQuoteQty: '0', stopPrice: q.get('pendingBelowStopPrice'), kind: 'stop', updateTime: Date.now() };
      x.lists[lid] = { symbol, listClientOrderId: lid, orderListId: x.listSeq++, status: filled ? 'EXECUTING' : 'ALL_DONE', orders: ids, qty };
      if (filled) x.balances[base] = (x.balances[base] ?? 0) + Number(qty) * 0.999;      // 0.1% fee taken from base asset in this fake
      x.balances.USDT -= filled ? Number(qty) * Number(wp) : 0;
      return json({ symbol, listClientOrderId: lid, orderListId: x.lists[lid].orderListId, orders: [] });
    }
    if (p === '/api/v3/orderList' && m === 'GET') {
      const l = x.lists[q.get('origClientOrderId')]; if (!l) return err(-2013, 'Order list does not exist.');
      return json({ symbol: l.symbol, listClientOrderId: l.listClientOrderId, orderListId: l.orderListId, listOrderStatus: l.status, orders: l.orders.map(orderId => ({ orderId })) });
    }
    if (p === '/api/v3/orderList' && m === 'DELETE') {
      const l = x.lists[q.get('listClientOrderId')]; if (!l || l.status === 'ALL_DONE') return err(-2011, 'Unknown order sent.');
      for (const id of l.orders) { const o = orderOf(id); if (o.side === 'SELL') o.status = 'CANCELED'; }
      l.status = 'ALL_DONE'; return json({ orderListId: l.orderListId, listOrderStatus: 'ALL_DONE' });
    }
    if (p === '/api/v3/order' && m === 'POST') {
      assert.equal(q.get('type'), 'MARKET'); assert.equal(q.get('side'), 'SELL');
      const qty = q.get('quantity'), o = { orderId: x.nextId++, symbol, side: 'SELL', type: 'MARKET', clientOrderId: q.get('newClientOrderId'), status: 'FILLED', executedQty: qty,
        cummulativeQuoteQty: String(Number(qty) * (x.price - 0.05)), updateTime: Date.now(), kind: 'manual' };
      x.orders[o.orderId] = o; x.balances[base] -= Number(qty);
      if (x.failSellPost) throw Error('Fixture transport timeout after exchange acceptance');
      return json(o);
    }
    if (p === '/api/v3/order' && m === 'GET') {
      const o = q.get('orderId') ? orderOf(Number(q.get('orderId'))) : byClient(q.get('origClientOrderId'));
      if (!o) return err(-2013, 'Order does not exist.');
      return json({ ...o, clientOrderId: o.clientOrderId });
    }
    if (p === '/api/v3/myTrades') {
      const o = orderOf(Number(q.get('orderId'))); if (!o || !Number(o.executedQty)) return json([]);
      const isBuy = o.side === 'BUY', quote = Number(o.cummulativeQuoteQty), qty = Number(o.executedQty);
      return json([{ id: o.orderId * 10, orderId: o.orderId, symbol: o.symbol, qty: String(qty), quoteQty: String(quote), price: String(quote / qty),
        commission: isBuy ? String(qty * 0.001) : String(quote * 0.001), commissionAsset: isBuy ? o.symbol.replace(/USDT$/, '') : 'USDT' }]);
    }
    throw Error('Unexpected fake endpoint ' + m + ' ' + p);
  });
  return x;
}
export const intent = (symbol, over = {}) => ({ symbol, strategy: 'pullback-trend', variant: 'a', family: 'trend', regime: 'trend-up', mode: 'live', riskMult: 1, score: 0.3,
  entry: 100, stopPct: 0.012, targetPct: 0.03, maxBars: 8, reason: 'fixture', features: {}, shadowId: 's-' + symbol, signalAt: Date.now() - 60000, estimate: 0.3, ...over });
