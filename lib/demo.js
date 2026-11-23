import { createHmac } from 'node:crypto';
import { pairs } from './settings.js';

export const BASE = 'https://demo-api.binance.com';
const publicReads = new Set(['/api/v3/time', '/api/v3/ping', '/api/v3/klines', '/api/v3/exchangeInfo', '/api/v3/ticker/bookTicker']);
const privateReads = new Set(['/api/v3/account', '/api/v3/allOrders', '/api/v3/myTrades', '/api/v3/order', '/api/v3/orderList']);
const orderPaths = new Set(['/api/v3/order', '/api/v3/order/test']);
const idPattern = /^ta-[a-f0-9]{28}$/;

export class DemoError extends Error {
  constructor(status, code) {
    super('Binance Demo HTTP ' + status + (Number.isInteger(code) ? ' (code ' + code + ')' : ''));
    this.code = code;
  }
}

async function request(path, params, signed, method = 'GET') {
  const url = new URL(path, BASE);
  if (url.origin !== BASE || url.pathname !== path) throw Error('Demo endpoint prohibited');
  const q = new URLSearchParams(params);
  const headers = {};
  if (signed) {
    const key = process.env.BINANCE_DEMO_API_KEY;
    const secret = process.env.BINANCE_DEMO_API_SECRET;
    if (!key || !secret) throw Error('Binance Demo credentials unavailable');
    q.set('timestamp', String(Date.now()));
    q.set('recvWindow', '5000');
    q.set('signature', createHmac('sha256', secret).update(q.toString()).digest('hex'));
    headers['X-MBX-APIKEY'] = key;
  }
  url.search = q.toString();
  const response = await fetch(url, { method, headers, redirect: 'error', signal: AbortSignal.timeout(7000) });
  const result = await response.json();
  if (!response.ok) {
    const error = new DemoError(response.status, result.code);
    error.definitiveReject = result.code === -2010 && /insufficient balance|market is closed|market orders are not supported/i.test(result.msg ?? '');
    throw error;
  }
  return result;
}

export async function demo(path, params = {}, signed = false) {
  if (!(signed ? privateReads : publicReads).has(path) || (params.symbol && !pairs.includes(params.symbol)) ||
      (path === '/api/v3/order' && !(idPattern.test(params.origClientOrderId) || Number.isSafeInteger(params.orderId) && params.orderId>0))) throw Error('Demo endpoint prohibited');
  return request(path, params, signed);
}

export async function account() {
  const data = await demo('/api/v3/account', {}, true);
  if (data.accountType !== 'SPOT' || !Array.isArray(data.balances)) throw Error('Binance Demo Spot account required');
  return data;
}

async function sendOrder(path, order) {
  const { symbol, side, clientId, amount } = order;
  if (!orderPaths.has(path) || !pairs.includes(symbol) || !['BUY', 'SELL'].includes(side) ||
      !idPattern.test(clientId) || typeof amount !== 'string' || !/^\d{1,8}(\.\d{1,8})?$/.test(amount) ||
      Number(amount) <= 0) throw Error('Invalid Demo Spot order');
  return request(path, {
    symbol, side, type: 'MARKET', newClientOrderId: clientId, newOrderRespType: 'FULL',
    [side === 'BUY' ? 'quoteOrderQty' : 'quantity']: amount
  }, true, 'POST');
}

export function deploymentCanTrade() {
  return process.env.VERCEL_ENV === 'production' && process.env.DEMO_EXECUTION_ENABLED === 'true' &&
    Boolean(process.env.VERCEL_GIT_COMMIT_SHA);
}

export function submitOrder(order) {
  if (!deploymentCanTrade()) throw Error('Demo execution deployment gate is closed');
  return sendOrder('/api/v3/order', order);
}

export async function validateDemoOrder(order) {
  const result = await sendOrder('/api/v3/order/test', order);
  if (!result || typeof result !== 'object' || Object.keys(result).length !== 0) {
    throw Error('Unexpected Demo test order response');
  }
}

export async function validateDemoWorkingOrder({symbol, clientId, price, quantity}) {
  if (!pairs.includes(symbol) || !idPattern.test(clientId) || ![price, quantity].every(value =>
    typeof value === 'string' && /^\d{1,10}(\.\d{1,8})?$/.test(value) && Number(value) > 0)) throw Error('Invalid Demo working order');
  const result = await request('/api/v3/order/test', {
    symbol, side: 'BUY', type: 'LIMIT', timeInForce: 'FOK', newClientOrderId: clientId, price, quantity
  }, true, 'POST');
  if (!result || Object.keys(result).length) throw Error('Unexpected Demo working-order validation response');
}

export async function bookQuote(symbol) {
  const quote = await demo('/api/v3/ticker/bookTicker', { symbol });
  const bid = Number(quote.bidPrice);
  const ask = Number(quote.askPrice);
  if (quote.symbol !== symbol || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) {
    throw Error('Demo order book unavailable');
  }
  return { bid, ask, spread: (ask - bid) / ask };
}

export async function checkDemoOrder() {
  const [wallet, ping] = await Promise.all([account(), demo('/api/v3/ping')]);
  if (wallet.canTrade !== true || !ping || typeof ping !== 'object') throw Error('Demo Spot trading permission required');
  await validateDemoOrder({ symbol: 'BTCUSDT', side: 'BUY', clientId: 'ta-' + '0'.repeat(28), amount: '10' });
}

async function bars(symbol, interval, limit, endTime) {
  const rows = await demo('/api/v3/klines', {
    symbol, interval, limit, ...(Number.isSafeInteger(endTime) ? { endTime } : {})
  });
  if (!Array.isArray(rows)) throw Error('Invalid Demo candle response');
  return rows.filter(row => Number.isSafeInteger(row?.[6]) && row[6] < Date.now() &&
    (!Number.isSafeInteger(endTime) || row[6] <= endTime));
}

export function candles(symbol, limit = 220) {
  return bars(symbol, '15m', limit);
}

export async function chartCandles(symbol, interval, limit) {
  const rows = await bars(symbol, interval, limit);
  return rows.map((row, index) => {
    const [open, high, low, close, volume] = row.slice(1, 6).map(Number);
    if (index && row[6] <= rows[index - 1][6] || ![open, high, low, close, volume].every(Number.isFinite) ||
        low <= 0 || high < Math.max(open, close) || low > Math.min(open, close) || volume < 0) {
      throw Error('Invalid Demo chart candle');
    }
    return { time: row[6], open, high, low, close, volume };
  });
}

export async function historicalCandles(symbol, recent) {
  let rows = recent ?? await candles(symbol);
  for (let page = 0; page < 3 && rows.length; page++) {
    const older = await bars(symbol, '15m', 1000, rows[0][0] - 1);
    if (!older.length) break;
    rows = [...older, ...rows];
    if (older.length < 1000) break;
  }
  return rows;
}

export async function rules(symbol) {
  const result = await demo('/api/v3/exchangeInfo', { symbol });
  const entry = result.symbols?.find(row => row.symbol === symbol);
  if (!entry?.isSpotTradingAllowed || entry.status !== 'TRADING' || entry.quoteAsset !== 'USDT' ||
      !entry.quoteOrderQtyMarketAllowed || !entry.orderTypes?.includes('MARKET') || !Array.isArray(entry.filters)) {
    throw Error('Demo Spot symbol is unavailable');
  }
  const lot = entry.filters.filter(item => ['LOT_SIZE', 'MARKET_LOT_SIZE'].includes(item.filterType));
  const minimums = entry.filters.filter(item => item.filterType === 'MIN_NOTIONAL' && item.applyToMarket ||
    item.filterType === 'NOTIONAL' && item.applyMinToMarket).map(item => Number(item.minNotional));
  const step = Math.max(...lot.map(item => Number(item.stepSize)));
  const minimum = Math.max(...minimums);
  const minQty = Math.max(...lot.map(item => Number(item.minQty)));
  const maxQty = Math.min(...lot.map(item => Number(item.maxQty)));
  if (![step, minimum, minQty, maxQty].every(Number.isFinite) || step <= 0 || minimum <= 0 || minQty <= 0 || maxQty <= minQty) {
    throw Error('Demo market filters unavailable');
  }
  const tickSize=Number(entry.filters.find(f=>f.filterType==='PRICE_FILTER')?.tickSize);
  return { step, minimum, minQty, maxQty, tickSize, baseAsset: entry.baseAsset, quoteAsset: entry.quoteAsset,
    opocoAllowed:entry.otoAllowed===true && entry.opoAllowed===true && entry.ocoAllowed===true &&
      entry.orderTypes.includes('LIMIT') && Number.isFinite(tickSize) && tickSize>0 };

}

export async function bookTicker(symbol) {
  return demo('/api/v3/ticker/bookTicker',{symbol});
}
export function demoOrderList(listId) {
  if(!/^tl-[a-f0-9]{28}$/.test(listId))throw Error('Invalid Demo order list ID');
  return demo('/api/v3/orderList',{origClientOrderId:listId},true);
}
export function placeDemoOpoco(order) {
  if(!deploymentCanTrade()||process.env.DEMO_AUTONOMOUS_ENABLED!=='true'||
     process.env.DEMO_BRACKET_ENABLED!=='true')throw Error('Demo OPOCO disabled');
  const {symbol,listClientOrderId,workingClientOrderId,workingPrice,workingQuantity,abovePrice,belowStopPrice}=order;
  if(!pairs.includes(symbol)||!/^tl-[a-f0-9]{28}$/.test(listClientOrderId)||
     !idPattern.test(workingClientOrderId))throw Error('Demo OPOCO identity invalid');
  for(const value of [workingPrice,workingQuantity,abovePrice,belowStopPrice]){
    if(typeof value!=='string'||!/^\d{1,10}(\.\d{1,8})?$/.test(value)||Number(value)<=0)
      throw Error('Demo OPOCO price or amount invalid');
  }
  if(!(Number(belowStopPrice)<Number(workingPrice)&&Number(abovePrice)>Number(workingPrice)))
    throw Error('Demo OPOCO protective pricing invalid');
  return request('/api/v3/orderList/opoco',{
    symbol,listClientOrderId,workingClientOrderId,workingType:'LIMIT',workingSide:'BUY',
    workingPrice,workingQuantity,workingTimeInForce:'FOK',pendingSide:'SELL',
    pendingAboveType:'LIMIT_MAKER',pendingAbovePrice:abovePrice,
    pendingBelowType:'STOP_LOSS',pendingBelowStopPrice:belowStopPrice,
    newOrderRespType:'FULL'
  },true,'POST');
}
