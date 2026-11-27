import { createHash } from 'node:crypto';
import { DemoError, account, bookQuote, bookTicker, cancelDemoOrderList, demoFills, demoOrder, placeDemoOpoco, rules, submitOrder, validateDemoWorkingOrder } from './demo.js';
import { engineQuote } from './engine-quote.js';
import { engineVersion } from './engine.js';
import { fillSummary } from './orders.js';
import { protectedDemoEnabled, resolveProtectedDemo } from './protected-demo.js';
import { currentVerification } from './risk.js';
import { engineSettings, periods } from './settings.js';
import { changeState, getState } from './store.js';

// Concurrent protected-trade executor. `state.pending` is now only a short DISPATCH slot; once the entry fills, the
// trade moves to `state.book` where its native OCO exits live on the exchange, freeing the slot for the next entry.
export const concurrentEnabled = () => protectedDemoEnabled() && process.env.DEMO_ENGINE_EXECUTION === 'true';
const no = (code, reason) => ({ accepted: false, code, reason });
const fixed = x => Number(x.toFixed(8)).toFixed(8);
const ownLease = (state, id) => { if (state.lease?.id !== id || state.lease.until <= Date.now()) throw Error('Research lease expired'); };
const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 28);
const message = error => (error instanceof Error && /^[a-z0-9][a-z0-9 .:;()_-]{0,180}$/i.test(error.message) ? error.message : 'Service unavailable');

export function asPending(t) {
  return { kind: 'opoco', status: 'dispatching', listId: t.listId, clientId: t.clientId, symbol: t.symbol, strategy: engineVersion, rule: t.strategy,
    reason: '', time: t.openedAt, quote: t.plan, entryObserved: true, entryFill: { quantity: t.quantity, price: t.entryPrice, time: t.openedAt, quote: t.cost }, mode: t.mode };
}

export async function dispatchEntry({ leaseId, intent, fingerprint, costs }) {
  const state = await getState();
  if (!concurrentEnabled()) return no('disabled', 'Concurrent engine execution is not enabled');
  const { symbol } = intent;
  const [wallet, filters, ticker] = await Promise.all([account(), rules(symbol), bookTicker(symbol)]);
  const sizing = { intent, wallet, filters, ticker, costs };
  const quote = engineQuote({ settings: state.settings, state, ...sizing });
  if (!quote.accepted) return quote;
  const clientId = 'ta-' + hash(leaseId + ':c:' + symbol + ':' + intent.signalAt), listId = 'tl-' + hash(leaseId + ':l:' + symbol + ':' + intent.signalAt);
  try { await validateDemoWorkingOrder({ symbol, clientId, price: quote.quoteLimit, quantity: quote.amount }); }
  catch (error) { return no('preflight', error?.code ? 'Signed Demo working order rejected (' + error.code + ')' : 'Signed Demo working-order check unavailable'); }
  const reservation = await changeState(current => {
    ownLease(current, leaseId);
    if (current.stopped || current.pending || !currentVerification(current, fingerprint) || !concurrentEnabled()) return { unchanged: true, value: no('lease', 'Demo safety lease not valid') };
    if (current.lastDispatchedCandle?.[symbol] === String(intent.signalAt)) return { unchanged: true, value: no('same-candle', 'Entry already sent for this signal') };
    const fresh = engineQuote({ settings: current.settings, state: current, ...sizing });
    if (!fresh.accepted) return { unchanged: true, value: fresh };
    const { day } = periods();
    const daily = current.days[day] ??= { volume: 0, trades: 0, loss: 0, orders: 0 };
    daily.orders = (daily.orders ?? daily.trades ?? 0) + 1;     // counted before the request, including ambiguous ones
    daily.entries = (daily.entries ?? 0) + 1;
    if (intent.mode === 'probe') daily.probes = (daily.probes ?? 0) + 1;
    current.lastDispatchedCandle ??= {};
    current.lastDispatchedCandle[symbol] = String(intent.signalAt);
    current.pending = { kind: 'opoco', concurrent: true, status: 'dispatching', clientId, listId, symbol, side: 'BUY', strategy: engineVersion, rule: intent.strategy,
      reason: intent.reason, quote: fresh, time: new Date().toISOString(), closedAt: new Date(intent.signalAt).toISOString(), mode: intent.mode,
      manager: { policy: engineVersion, side: 'BUY', reason: intent.reason }, verification: 'native-demo-opoco',
      engine: { strategy: intent.strategy, variant: intent.variant, family: intent.family, regime: intent.regime, riskMult: intent.riskMult,
        stopPct: intent.stopPct, targetPct: intent.targetPct, maxBars: intent.maxBars, shadowId: intent.shadowId, features: intent.features, estimate: intent.estimate } };
    return { accepted: true, quote: fresh };
  });
  if (!reservation.accepted) return reservation;
  const order = { symbol, listClientOrderId: listId, workingClientOrderId: clientId, workingPrice: quote.quoteLimit, workingQuantity: quote.amount,
    belowStopPrice: quote.stopPrice, abovePrice: quote.targetPrice };
  try {
    const ack = await placeDemoOpoco(order);
    if (ack?.symbol !== symbol || ack.listClientOrderId !== listId || !Number.isSafeInteger(ack.orderListId)) throw Error('Demo OPOCO response identity mismatch');
    await changeState(current => { if (current.pending?.listId !== listId) return { unchanged: true }; current.pending.orderListId = ack.orderListId; current.pending.acknowledgedAt = new Date().toISOString(); });
  } catch (error) {
    if (error instanceof DemoError && [-1013, -1021, -1022, -1100, -1102, -1111, -1116, -2010, -2015].includes(error.code)) {
      await changeState(current => { if (current.pending?.listId !== listId) return { unchanged: true }; current.pending = null; });
      return { ...no('demo-rejected', 'Binance Demo rejected the protected order'), clientId, listId };
    }
    return { ...reservation.quote, accepted: true, clientId, listId, reconciliation: 'required' };    // ambiguous: never retransmit
  }
  return { ...reservation.quote, accepted: true, clientId, listId, reconciliation: 'pending' };
}

// Per-strategy running performance, used for the dashboard and for audit alongside the learner.
function strategyStats(state, trade, netUsd) {
  const k = trade.strategy + ':' + trade.variant;
  const s = (state.strategyPerformance ??= {})[k] ??= { n: 0, wins: 0, netUsd: 0 };
  s.n++; s.wins += Number(netUsd > 0); s.netUsd += netUsd;
}
function settleClosed(state, trade, fill) {
  const { day, month } = periods(Date.parse(fill.time));
  const daily = state.days[day] ??= { volume: 0, trades: 0, loss: 0, orders: 0 };
  daily.orders = (daily.orders ?? daily.trades ?? 0) + 1;
  daily.volume += fill.exitQuote ?? 0;
  if (fill.dust > 1e-8) { state.dust ??= {}; state.dust[trade.symbol] = (state.dust[trade.symbol] ?? 0) + fill.dust; }
  state.realized += fill.netProfit;
  daily.loss += Math.max(0, -fill.netProfit);
  (state.months[month] ??= { loss: 0 }).loss += Math.max(0, -fill.netProfit);
  const perf = state.performance ??= { closed: 0, wins: 0, losses: 0, fees: 0 };
  perf.closed++; perf.wins += Number(fill.netProfit > 0); perf.losses += Number(fill.netProfit < 0); perf.fees += fill.feeUsd ?? 0;
  strategyStats(state, trade, fill.netProfit);
  if (state.book) delete state.book[trade.listId];
  const riskUsd = Math.max(trade.cost * trade.plan.stopPct, 1e-9);
  const exitReason = fill.exitReason ?? (fill.exitPrice >= trade.plan.targetPrice * 0.999 ? 'target' : 'stop');
  return { status: 'closed', outcome: { shadowId: trade.shadowId, symbol: trade.symbol, strategy: trade.strategy, variant: trade.variant, family: trade.family,
    mode: trade.mode, exit: exitReason, netUsd: fill.netProfit, net: fill.netProfit / trade.cost, r: fill.netProfit / riskUsd, openedAt: trade.openedAt, closedAt: fill.time, fees: fill.feeUsd } };
}
const bookEntry = (p, fill) => ({
  listId: p.listId, clientId: p.clientId, orderListId: fill.orderListId ?? p.orderListId ?? null, entryOrderId: fill.orderId ?? null, symbol: p.symbol,
  strategy: p.engine.strategy, variant: p.engine.variant, family: p.engine.family, regime: p.engine.regime, mode: p.mode, riskMult: p.engine.riskMult,
  shadowId: p.engine.shadowId, features: p.engine.features,
  plan: { stopPrice: Number(p.quote.stopPrice), targetPrice: Number(p.quote.targetPrice), stopPct: p.engine.stopPct, targetPct: p.engine.targetPct,
    riskUsd: p.quote.riskUsd, expectedWorstUsd: p.quote.expectedWorstUsd },
  quantity: fill.quantity, entryPrice: fill.price ?? fill.quote / fill.quantity, cost: fill.quote, openedAt: fill.time,
  deadline: Date.parse(fill.time) + p.engine.maxBars * 900000
});

export function applyEnginePending(state, fill) {
  const p = state.pending;
  if (!p?.concurrent) throw Error('No concurrent dispatch to settle');
  const { day } = periods(Date.parse(fill.time));
  const daily = state.days[day] ??= { volume: 0, trades: 0, loss: 0, orders: 0 };
  if (fill.kind === 'protectedOpen') {
    daily.trades++; daily.volume += fill.quote;
    (state.book ??= {})[p.listId] = bookEntry(p, fill);
    state.pending = null;
    return { status: 'opened', listId: p.listId };
  }
  if (!(fill.quantity > 0)) { state.pending = null; daily.unfilled = (daily.unfilled ?? 0) + 1; return { status: 'unfilled', code: fill.status }; }
  daily.trades++; daily.volume += fill.quote;
  const trade = bookEntry(p, { ...fill, quote: fill.quote, price: fill.entryPrice, time: fill.entryAt ?? fill.time, orderId: null });
  state.pending = null;
  return settleClosed(state, trade, fill);
}

// Resolve the short-lived dispatch slot. Returns the learning outcome when a trade already closed.
export async function settlePending(leaseId) {
  const state = await getState(), p = state.pending;
  if (!p?.concurrent) return null;
  let fill;
  try { fill = await resolveProtectedDemo(p); } catch (error) { return { status: 'error', error: message(error) }; }
  if (!fill) return { status: 'waiting' };
  return changeState(latest => {
    ownLease(latest, leaseId);
    if (latest.pending?.listId !== p.listId) return { unchanged: true, value: { status: 'stale' } };
    return applyEnginePending(latest, fill);
  });
}

async function entryFees(trade, filters) {
  const fills = await demoFills(trade.symbol, trade.entryOrderId);
  const bnb = fills.some(f => f.commissionAsset === 'BNB' && Number(f.commission) > 0) ? (await bookQuote('BNBUSDT')).ask : 0;
  let cash = 0, base = 0;
  for (const f of fills) {
    const fee = Number(f.commission);
    if (f.commissionAsset === 'USDT') cash += fee; else if (f.commissionAsset === filters.baseAsset) base += fee; else if (f.commissionAsset === 'BNB') cash += fee * bnb; else if (fee > 0) throw Error('Unsupported fee token');
  }
  return { cash, base };
}

async function advanceExit(leaseId, listId, now) {
  let t = (await getState()).book?.[listId];
  if (!t?.exit) return { status: 'open' };
  const { symbol } = t;
  if (t.exit.status === 'cancelling') {
    try { await cancelDemoOrderList({ symbol, listClientOrderId: t.listId }); }
    catch (error) {
      if (error instanceof DemoError && [-2011, -2013].includes(error.code)) {
        const fill = await resolveProtectedDemo(asPending(t)).catch(() => null);
        return changeState(latest => {
          ownLease(latest, leaseId);
          const cur = latest.book?.[listId];
          if (!cur) return { unchanged: true, value: { status: 'stale' } };
          if (fill) return settleClosed(latest, cur, fill);
          cur.exit = null; cur.deadline = now + 3600000;       // could not cancel and not complete: look again later
          return { status: 'open' };
        });
      }
      return { status: 'exit-cancel-unconfirmed' };            // still protected by the exchange; retry next cycle
    }
    await changeState(latest => { ownLease(latest, leaseId); const cur = latest.book?.[listId]; if (cur?.exit) cur.exit.status = 'selling'; });
    t = { ...t, exit: { ...t.exit, status: 'selling' } };
  }
  if (t.exit.status !== 'selling') return { status: 'open' };
  let order = null;
  try { order = await demoOrder(symbol, t.exit.clientId); }
  catch (error) { if (!(error instanceof DemoError && error.code === -2013)) return { status: 'exit-unknown' }; }
  if (!order) {
    if (t.exit.sentAt && now - t.exit.sentAt < 180000) return { status: 'exit-wait' };
    const [wallet, filters] = await Promise.all([account(), rules(symbol)]);
    const free = Number(wallet.balances.find(b => b.asset === filters.baseAsset)?.free ?? 0);
    const fees = t.entryFees ?? await entryFees(t, filters);
    const qty = Math.floor(Math.min(free, t.quantity - fees.base) / filters.step + 1e-9) * filters.step;
    if (!(qty >= filters.minQty)) return { status: 'exit-dust' };
    await changeState(latest => { ownLease(latest, leaseId); const cur = latest.book?.[listId]; if (cur?.exit) { cur.exit.sentAt = now; cur.entryFees = fees; } });
    try { await submitOrder({ symbol, side: 'SELL', clientId: t.exit.clientId, amount: fixed(qty) }); } catch { /* reconciled below or next cycle; never retransmitted */ }
    try { order = await demoOrder(symbol, t.exit.clientId); } catch { return { status: 'exit-wait' }; }
    t = { ...t, entryFees: fees };
  }
  if (!['FILLED', 'CANCELED', 'EXPIRED', 'REJECTED'].includes(order.status)) return { status: 'exit-wait' };
  if (!(Number(order.executedQty) > 0)) {
    await changeState(latest => { ownLease(latest, leaseId); const cur = latest.book?.[listId]; if (cur?.exit) { cur.exitAttempts = (cur.exitAttempts ?? 0) + 1; cur.exit = cur.exitAttempts >= 3 ? null : { clientId: 'ta-' + hash(listId + ':exit:' + cur.exitAttempts), status: 'selling', at: now, sentAt: null }; if (!cur.exit) cur.deadline = now + 6 * 3600000; } });
    return { status: 'exit-retry' };
  }
  const [filters, fills] = await Promise.all([rules(symbol), demoFills(symbol, order.orderId)]);
  const bnb = fills.some(f => f.commissionAsset === 'BNB' && Number(f.commission) > 0) ? (await bookQuote('BNBUSDT')).ask : undefined;
  const sell = fillSummary(order, fills, { symbol, clientId: t.exit.clientId, side: 'SELL', baseAsset: filters.baseAsset }, bnb);
  const fees = t.entryFees ?? await entryFees(t, filters);
  const fill = { time: sell.time, netProfit: sell.quote - sell.quoteFee - (t.cost + fees.cash), exitQuote: sell.quote, feeUsd: fees.cash + sell.feeUsd, exitPrice: sell.price,
    dust: Math.max(0, t.quantity - fees.base - sell.quantity), exitReason: 'time-stop' };
  return changeState(latest => {
    ownLease(latest, leaseId);
    const cur = latest.book?.[listId];
    if (!cur) return { unchanged: true, value: { status: 'stale' } };
    return settleClosed(latest, cur, fill);
  });
}

async function reconcileTrade(leaseId, trade, now) {
  if (trade.exit) return advanceExit(leaseId, trade.listId, now);
  const fill = await resolveProtectedDemo(asPending(trade));
  if (fill) {
    return changeState(latest => {
      ownLease(latest, leaseId);
      const cur = latest.book?.[trade.listId];
      if (!cur) return { unchanged: true, value: { status: 'stale' } };
      return settleClosed(latest, cur, fill);
    });
  }
  const timeStops = engineSettings((await getState()).settings).timeStops;
  if ((timeStops || trade.forceExit) && now >= trade.deadline) {
    let filters, fees;
    try { filters = await rules(trade.symbol); fees = await entryFees(trade, filters); } catch { return { status: 'open' }; }   // no cancel without everything needed to sell
    await changeState(latest => {
      ownLease(latest, leaseId);
      const cur = latest.book?.[trade.listId];
      if (cur && !cur.exit) { cur.entryFees = fees; cur.exit = { clientId: 'ta-' + hash(trade.listId + ':exit:' + (cur.exitAttempts ?? 0)), status: 'cancelling', at: now, sentAt: null }; }
    });
    return advanceExit(leaseId, trade.listId, now);
  }
  return { status: 'open' };
}

// Reconcile every protected trade. Safe to call every cycle and while stopped (exits only reduce exposure).
export async function reconcileBook(leaseId, now = Date.now()) {
  const state = await getState(), results = [];
  for (const trade of Object.values(state.book ?? {})) {
    try { results.push({ listId: trade.listId, symbol: trade.symbol, ...(await reconcileTrade(leaseId, trade, now)) }); }
    catch (error) { results.push({ listId: trade.listId, symbol: trade.symbol, status: 'error', error: message(error) }); }
  }
  return results;
}
export const closedOutcomes = results => results.filter(r => r?.status === 'closed' && r.outcome).map(r => r.outcome);
