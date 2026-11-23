import { createHash, createHmac } from 'node:crypto';
import { account, bookQuote, checkDemoOrder, demo, deploymentCanTrade, rules, submitOrder, validateDemoOrder } from './demo.js';
import { periods } from './settings.js';
import { eligibleMetrics, threshold } from './forecast.js';
import { orderModel } from './playbook.js';
import { changeState, getState } from './store.js';
import { currentVerification, evaluateRisk } from './risk.js';
import { trialBlock } from './manager.js';

export function fingerprint() {
  const { VERCEL_GIT_COMMIT_SHA, BINANCE_DEMO_API_KEY, BINANCE_DEMO_API_SECRET, ADMIN_PASSWORD_HASH } = process.env;
  if (!VERCEL_GIT_COMMIT_SHA || !BINANCE_DEMO_API_KEY || !BINANCE_DEMO_API_SECRET || !ADMIN_PASSWORD_HASH) return null;
  return createHmac('sha256', process.env.SESSION_SECRET || ADMIN_PASSWORD_HASH).update(JSON.stringify([
    VERCEL_GIT_COMMIT_SHA, BINANCE_DEMO_API_KEY, BINANCE_DEMO_API_SECRET
  ])).digest('hex');
}

export async function verifyExecution() {
  const key = fingerprint();
  if (!key) throw Error('Demo deployment identity or credentials unavailable');
  await checkDemoOrder();
  const checkedAt = Date.now();
  return { fingerprint: key, checkedAt, expires: checkedAt + 7 * 86400000 };
}

function ownLease(state, id) {
  if (state.lease?.id !== id || state.lease.until <= Date.now()) throw Error('Research lease expired');
}

export function executionAllowed(state) {
  return deploymentCanTrade() && currentVerification(state, fingerprint());
}

function entryEvidence(state, symbol, decision, market) {
  if (decision.side !== 'BUY') return null;
  if (decision.mode === 'demo-trial') {
    const blocked = trialBlock(state, symbol, decision);
    if (blocked) return { accepted: false, code: 'trial-policy', reason: blocked };
    return state.lastDispatchedCandle?.[symbol] === market.closedAt
      ? { accepted: false, code: 'same-candle', reason: 'An entry was already dispatched for this candle' } : null;
  }
  const model = orderModel(state);
  const forecast = decision.forecast;
  const entry = model?.models?.[symbol];
  const rule = decision.rule ?? 'trend';
  const metrics = entry?.rules ? entry.rules[rule] : rule === 'trend' ? entry?.metrics : null;
  if (!forecast?.eligible || !Number.isFinite(forecast.probability) || forecast.probability < threshold ||
      !eligibleMetrics(metrics) || model.strategy !== state.strategy.id || forecast.model !== model.id ||
      (forecast.rule ?? 'trend') !== rule ||
      !(Date.parse(model.expiresAt) > Date.now())) {
    return { accepted: false, code: 'forecast', reason: 'Current approved high-confidence evidence is required for entries' };
  }
  if (state.lastDispatchedCandle?.[symbol] === market.closedAt) {
    return { accepted: false, code: 'same-candle', reason: 'An entry was already dispatched for this candle' };
  }
  return null;
}

export async function previewTrialOrder({ symbol, decision, market, state }) {
  if (process.env.VERCEL_ENV !== 'preview' || decision.mode !== 'demo-trial' || decision.side !== 'BUY') {
    throw Error('Preview order validation required');
  }
  const [wallet, limits, quote] = await Promise.all([account(), rules(symbol), bookQuote(symbol)]);
  if (quote.spread > 0.006) return { accepted: false, code: 'spread', reason: 'Demo trial spread exceeds 0.6%' };
  const risk = evaluateRisk({ state: { ...state, stopped: false }, symbol, decision, market, wallet, rules: limits, verified: true });
  if (!risk.accepted) return risk;
  await validateDemoOrder({ symbol, side: 'BUY', clientId: 'ta-' + '1'.repeat(28), amount: risk.amount });
  return { ...risk, accepted: false, code: 'preview-validated', reason: 'Signed order validation passed without dispatch' };
}

export async function evaluateOrder({ leaseId, symbol, decision, market, prerequisites }) {
  const state = await getState();
  const base = { state, decision, symbol, market, verified: prerequisites && executionAllowed(state) };
  if (!base.verified || state.stopped || decision.side === 'HOLD' || state.pending) return evaluateRisk(base);
  const rejected = entryEvidence(state, symbol, decision, market);
  if (rejected) return rejected;
  const [wallet, filters, quote] = await Promise.all([account(), rules(symbol),
    decision.mode === 'demo-trial' ? bookQuote(symbol) : null]);
  if (quote && decision.side === 'BUY' && quote.spread > 0.006) {
    return { accepted: false, code: 'spread', reason: 'Demo trial spread exceeds 0.6%' };
  }
  if (quote && decision.side === 'SELL') base.market = { ...market, price: quote.bid };
  const id = 'ta-' + createHash('sha256').update(leaseId + ':' + symbol).digest('hex').slice(0, 28);
  const verification = fingerprint();
  const result = await changeState(latest => {
    ownLease(latest, leaseId);
    const rejected = entryEvidence(latest, symbol, decision, market);
    if (rejected) return { unchanged: true, value: rejected };
    const risk = evaluateRisk({
      ...base, state: latest, rules: filters, wallet,
      verified: deploymentCanTrade() && currentVerification(latest, verification)
    });
    if (!risk.accepted) return { unchanged: true, value: risk };
    latest.pending = {
      clientId: id, symbol, side: decision.side, amount: risk.amount, baseAsset: filters.baseAsset,
      time: new Date().toISOString(), status: 'reserved', strategy: latest.strategy.id, reason: decision.reason,
      forecast: decision.forecast ?? null, rule: decision.rule ?? null, closedAt: market.closedAt, risk,
      mode: decision.mode, manager: decision.manager, quote, lotStep: filters.step
    };
    return risk;
  });
  if (!result.accepted) return result;
  if (decision.mode === 'demo-trial' && decision.side === 'BUY') {
    try { await validateDemoOrder({ symbol, side: 'BUY', clientId: id, amount: result.amount }); }
    catch (error) {
      await changeState(latest => {
        ownLease(latest, leaseId);
        if (latest.pending?.clientId === id && latest.pending.status === 'reserved') latest.pending = null;
      });
      return { accepted: false, code: 'trial-preflight', reason: error?.code ?
        'Signed Demo trial preflight rejected (' + error.code + ')' : 'Signed Demo trial preflight unavailable' };
    }
  }
  const reserved = await changeState(latest => {
    ownLease(latest, leaseId);
    if (latest.pending?.clientId !== id || latest.pending.status !== 'reserved') throw Error('Order reservation missing');
    if (latest.stopped || !executionAllowed(latest)) {
      latest.pending = null;
      return null;
    }
    const { day } = periods();
    const daily = latest.days[day] ??= { volume: 0, trades: 0, loss: 0 };
    // Count dispatches before calling the exchange, including ambiguous or rejected requests.
    daily.orders = (daily.orders ?? daily.trades) + 1;
    latest.pending.status = 'dispatching';
    if (decision.side === 'BUY') {
      if (decision.mode === 'demo-trial') {
        latest.trial = { ...latest.trial, day, opens: latest.trial?.day === day ? latest.trial.opens + 1 : 1 };
      }
      latest.lastDispatchedCandle ??= {};
      latest.lastDispatchedCandle[symbol] = market.closedAt;
    }
    return latest.pending;
  });
  if (!reserved) return { accepted: false, reason: 'Execution was stopped before dispatch' };

  try {
    await submitOrder(reserved);
  } catch (error) {
    // These Binance errors reject a request before it reaches the matching engine.
    if (error?.definitiveReject || [-1013, -1021, -1022, -2015].includes(error?.code)) {
      await changeState(latest => {
        ownLease(latest, leaseId);
        if (latest.pending?.clientId !== id) throw Error('Order reservation missing');
        latest.pending.rejectionCode = error.code;
      });
    }
    // An ambiguous response can follow an accepted order. Reconcile by client ID without retransmission.
  }
  return { ...result, clientId: id, reconciliation: 'pending' };
}

export function fillSummary(order, fills, pending, bnbMark) {
  if (order.symbol !== pending.symbol || order.clientOrderId !== pending.clientId ||
      order.side !== pending.side || order.type !== 'MARKET') throw Error('Unexpected Demo order identity');
  const quantity = Number(order.executedQty);
  const quote = Number(order.cummulativeQuoteQty);
  if (!Number.isFinite(quantity) || !Number.isFinite(quote) || quantity < 0 || quote < 0) throw Error('Invalid Demo execution totals');
  if (!['FILLED', 'CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH', 'REJECTED'].includes(order.status)) return null;
  const fees = new Map();
  const seen = new Set();
  let filledQuantity = 0;
  let quoteQuantity = 0;
  for (const fill of fills) {
    if (fill.orderId !== order.orderId || fill.symbol !== order.symbol || seen.has(fill.id)) throw Error('Invalid or duplicate Demo fill');
    const fee = Number(fill.commission);
    const size = Number(fill.qty);
    const notional = Number(fill.quoteQty);
    if (![fee, size, notional].every(Number.isFinite) || fee < 0 || size <= 0 || notional <= 0) throw Error('Invalid Demo fill');
    if (![pending.baseAsset, 'USDT'].includes(fill.commissionAsset) && fee > 0 &&
        !(fill.commissionAsset === 'BNB' && Number.isFinite(bnbMark) && bnbMark > 0)) throw Error('Unsupported Demo fee asset');
    seen.add(fill.id);
    filledQuantity += size;
    quoteQuantity += notional;
    fees.set(fill.commissionAsset, (fees.get(fill.commissionAsset) ?? 0) + fee);
  }
  if (Math.abs(filledQuantity - quantity) > 1e-8 || Math.abs(quoteQuantity - quote) > 1e-7 ||
      (quantity > 0 && (!fills.length || quote <= 0))) throw Error('Demo fill details incomplete');
  const price = quantity ? quote / quantity : null;
  const baseFee = fees.get(pending.baseAsset) ?? 0;
  const bnbFee = pending.baseAsset === 'BNB' ? 0 : ((fees.get('BNB') ?? 0) * (bnbMark ?? 0));
  const quoteFee = (fees.get('USDT') ?? 0) + bnbFee;
  if (baseFee >= quantity && quantity > 0 || quoteFee >= quote && quote > 0) throw Error('Invalid Demo fees');
  return { clientId: pending.clientId, orderId: order.orderId, symbol: order.symbol, side: order.side,
    status: order.status, submittedAt: pending.time, time: new Date(order.updateTime).toISOString(),
    strategy: pending.strategy, reason: pending.reason, risk: pending.risk, forecast: pending.forecast, rule: pending.rule,
    closedAt: pending.closedAt, baseFee, quoteFee, mode: pending.mode, manager: pending.manager, referenceQuote: pending.quote,
    bnbFeeMark: bnbFee ? bnbMark : null, lotStep: pending.lotStep,
    fees: Object.fromEntries(fees), feeUsd: quoteFee + baseFee * (price ?? 0), quantity, quote, price };
}

export async function resolvePending(state, leaseId) {
  const pending = state.pending;
  if (!pending) return null;
  if (pending.status === 'reserved') {
    // Only the dispatched state is allowed to reach the exchange.
    return { pending, fill: null };
  }
  ownLease(state, leaseId);
  if (pending.rejectionCode) return { pending, fill: {
    ...pending, status: 'REJECTED', reason: pending.reason + ' (Binance Demo code ' + pending.rejectionCode + ')',
    quantity: 0, quote: 0, price: null, fees: {}, feeUsd: 0
  } };
  const order = await demo('/api/v3/order', { symbol: pending.symbol, origClientOrderId: pending.clientId }, true);
  const fills = Number(order.executedQty) ? await demo('/api/v3/myTrades', {
    symbol: pending.symbol, orderId: order.orderId, limit: 1000
  }, true) : [];
  const bnbMark = pending.baseAsset !== 'BNB' && fills.some(fill => fill.commissionAsset === 'BNB' && Number(fill.commission) > 0)
    ? (await bookQuote('BNBUSDT')).ask : undefined;
  const fill = fillSummary(order, fills, pending, bnbMark);
  if (!fill) throw Error('Demo order has not reached terminal status');
  return { pending, fill };
}

export function applyFill(state, resolved) {
  if (!resolved) return null;
  if (state.pending?.clientId !== resolved.pending.clientId) throw Error('Demo order reconciliation conflict');
  const fill = resolved.fill;
  state.pending = null;
  if (!fill?.quantity) return fill;
  const { day, month } = periods(Date.parse(fill.time));
  const daily = state.days[day] ??= { volume: 0, trades: 0, loss: 0 };
  daily.volume += fill.quote;
  const performance = state.performance ??= { closed: 0, wins: 0, losses: 0, fees: 0 };
  performance.fees += fill.feeUsd;
  if (fill.side === 'BUY') {
    if (state.positions[fill.symbol]) throw Error('Duplicate position');
    daily.trades++;
    state.positions[fill.symbol] = {
      entryId: fill.clientId, strategy: fill.strategy, time: fill.time, price: fill.price,
      cost: fill.quote + fill.quoteFee, quantity: fill.quantity - fill.baseFee, fees: fill.fees,
      forecast: fill.forecast, rule: fill.rule, closedAt: fill.closedAt, mode: fill.mode
    };
    if (fill.mode === 'demo-trial') state.trial = { ...state.trial, verifiedFill: fill.clientId };
    return fill;
  }
  const position = state.positions[fill.symbol];
  const used = fill.quantity + fill.baseFee;
  if (!position || used > position.quantity + 1e-9) throw Error('Demo exit exceeds tracked exposure');
  const residual = Math.max(0, position.quantity - used);
  const dust = Number.isFinite(fill.lotStep) && residual > 0 && residual < fill.lotStep - 1e-9 ? residual : 0;
  const allocated = dust ? position.cost : position.cost * Math.min(1, used / position.quantity);
  const netProfit = fill.quote - fill.quoteFee - allocated;
  if (dust) {
    state.dust ??= {};
    state.dust[fill.symbol] = (state.dust[fill.symbol] ?? 0) + dust;
  }
  state.realized += netProfit;
  const loss = Math.max(0, -netProfit);
  daily.loss += loss;
  const monthly = state.months[month] ??= { loss: 0 };
  monthly.loss += loss;
  performance.closed++;
  performance.wins += Number(netProfit > 0);
  performance.losses += Number(netProfit < 0);
  position.quantity -= used;
  position.cost -= allocated;
  if (dust || position.quantity < 1e-8) delete state.positions[fill.symbol];
  return { ...fill, entryId: position.entryId, entryTime: position.time, entryPrice: position.price,
    entryStrategy: position.strategy, entryFees: position.fees, netProfit,
    entryForecast: position.forecast, entryCandle: position.closedAt, entryRule: position.rule, entryMode: position.mode, entryCost: allocated, dust };
}
