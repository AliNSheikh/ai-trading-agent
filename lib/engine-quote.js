import { engineSettings, inUsd, periods } from './settings.js';

const floorTo = (v, step) => Math.floor(v / step + 1e-9) * step;
const ceilTo = (v, step) => Math.ceil(v / step - 1e-9) * step;
const fixed = x => Number(x.toFixed(8)).toFixed(8);
const no = (code, reason) => ({ accepted: false, code, reason });
export const bookRisk = state => Object.values(state.book ?? {});

// Sizes an entry from its STOP DISTANCE (risk-based), then applies every portfolio, loss, volume and exchange limit.
// Pure: no network, no state writes. Used for preview, dispatch and the in-lease re-check.
export function engineQuote({ settings, state, intent, wallet, filters, ticker, costs, now = Date.now() }) {
  const e = engineSettings(settings);
  if (!e.enabled) return no('engine-disabled', 'Multi-strategy engine is disabled in settings');
  if (!settings || !state || !intent || !wallet || !filters || !ticker) return no('inputs', 'Missing verified Demo input');
  if (state.stopped) return no('stopped', 'Demo execution is stopped');
  if (state.pending) return no('busy', 'Another order requires reconciliation');
  if (!filters.opocoAllowed) return no('unsupported', 'Symbol does not support native OPOCO protection');
  if (wallet.canTrade !== true) return no('account', 'Demo account cannot trade Spot');
  const { day, month } = periods(now);
  const daily = state.days?.[day] ?? { orders: 0, trades: 0, volume: 0, loss: 0 };
  const monthLoss = state.months?.[month]?.loss ?? 0;
  const open = bookRisk(state);
  if (open.length >= Math.min(e.maxConcurrent, settings.maxOpenPositions)) return no('max-open', 'Concurrent position limit reached');
  if (open.some(t => t.symbol === intent.symbol)) return no('duplicate-symbol', 'A trade is already open on this pair');
  if (open.filter(t => t.family === intent.family).length >= e.maxPerFamily) return no('family-cap', 'Too many open trades from one strategy family');
  if ((daily.entries ?? 0) >= e.entriesPerDay) return no('entry-cap', 'Daily entry cap reached');
  if (intent.mode === 'probe' && (daily.probes ?? 0) >= e.probesPerDay) return no('probe-cap', 'Daily exploration cap reached');
  const orders = daily.orders ?? daily.trades ?? 0;
  if (orders + 1 + open.length + 1 > settings.maxTrades) return no('daily-cap', 'Daily order cap reached (exits are reserved)');

  const ask = Number(ticker.askPrice), bid = Number(ticker.bidPrice);
  if (![ask, bid].every(Number.isFinite) || ask <= 0 || bid <= 0 || bid > ask) return no('spread', 'Demo bid/ask unavailable');
  const spread = (ask - bid) / ask;
  if (spread > 0.004) return no('spread', 'Spread exceeds 0.4%');
  if (Math.abs(ask / intent.entry - 1) > 0.01) return no('market-deviation', 'Quote moved more than 1% from the signal candle');
  const fee = Number(wallet.commissionRates?.taker) + Number(wallet.commissionRates?.buyer ?? 0);
  if (!Number.isFinite(fee) || fee < 0 || fee > 0.002) return no('fees', 'Demo fee rate unavailable or above the modeled buffer');

  const slip = costs?.slip ?? 0.0005;
  const roundTrip = 2 * (fee + slip) + spread;
  if (intent.targetPct < (costs?.costMultiple ?? 3.5) * roundTrip) return no('cost-gate', 'Target does not clear round-trip costs by the required multiple');
  const price = ceilTo(ask * 1.001, filters.tickSize);
  const stop = floorTo(price * (1 - intent.stopPct), filters.tickSize), target = ceilTo(price * (1 + intent.targetPct), filters.tickSize);
  if (!(stop > 0 && stop < bid && target > ask)) return no('filters', 'Stop or target violates exchange price rules');
  const lossFraction = (price - stop) / price + roundTrip + 0.003;     // stop distance + costs + slippage reserve
  const riskUsd = inUsd(settings, 'riskPerTrade') * intent.riskMult;
  const openWorst = open.reduce((s, t) => s + (t.plan?.expectedWorstUsd ?? 0), 0);
  const openCost = open.reduce((s, t) => s + (t.cost ?? 0), 0);
  const usdt = Number(wallet.balances?.find(b => b.asset === 'USDT')?.free ?? 0);
  const caps = {
    risk: riskUsd / lossFraction,
    position: inUsd(settings, 'maxPosition'),
    allocation: settings.capital + Math.min(0, state.realized ?? 0) - openCost,
    wallet: usdt / 1.01,
    volume: (inUsd(settings, 'dailyVolume') - (daily.volume ?? 0)) / 2,
    heat: (settings.capital * e.heatPercent / 100 - openWorst) / lossFraction,
    dailyLoss: (inUsd(settings, 'dailyLoss') - (daily.loss ?? 0) - openWorst) / lossFraction,
    monthlyLoss: (inUsd(settings, 'monthlyLoss') - monthLoss - openWorst) / lossFraction
  };
  let notional = Math.min(...Object.values(caps));
  if (!Number.isFinite(notional) || notional <= 0) {
    const limiting = Object.entries(caps).sort((a, b) => a[1] - b[1])[0][0];
    return no('risk-limit', 'No headroom under the ' + limiting + ' limit');
  }
  let quantity = floorTo(notional / (price * 1.003), filters.step);
  const minimum = filters.minimum * 1.05;
  if (quantity * price < minimum) {
    // An exploratory probe may round UP to the exchange minimum when that stays inside every cap.
    const needed = minimum;
    const limit = Math.min(caps.position, caps.allocation, caps.wallet, caps.volume, caps.heat, caps.dailyLoss, caps.monthlyLoss);
    if (intent.mode !== 'probe' || needed > limit || needed * lossFraction > Math.max(riskUsd, 0.01) * 2) return no('minimum', 'Risk-based size is below the Demo minimum order');
    quantity = ceilTo(needed / price, filters.step);
  }
  const quoted = quantity * price;
  if (!(quantity >= filters.minQty && quantity <= filters.maxQty) || stop * quantity < filters.minimum) return no('filters', 'Quantity or stop-leg notional violates exchange limits');
  const expectedWorstUsd = quoted * lossFraction;
  return { accepted: true, code: 'engine-entry', amount: fixed(quantity), notional: quoted, quoteLimit: fixed(price), stopPrice: fixed(stop), targetPrice: fixed(target),
    stopPercent: intent.stopPct * 100, targetPercent: intent.targetPct * 100, riskUsd, expectedWorstUsd, roundTripCost: roundTrip, feeRate: fee, spread, caps,
    reason: 'Risk-sized from stop distance with native linked OPOCO exits; stop price is not guaranteed' };
}
