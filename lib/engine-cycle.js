import { analyze, engineVersion, newLearning, recordLive } from './engine.js';
import { closedOutcomes, concurrentEnabled, dispatchEntry, reconcileBook, settlePending } from './executor.js';
import { executionAllowed, fingerprint } from './orders.js';
import { engineSettings } from './settings.js';
import { changeLearning, getLearning, getState } from './store.js';

const timestamp = () => new Date().toISOString();
// LLM sentiment may only TRIM risk. Unavailable AI never blocks a trade; it applies a mild haircut instead.
export const sentimentMultiplier = sentiment => sentiment === 'negative' ? 0.5 : sentiment === 'mixed' ? 0.75 : sentiment === 'positive' || sentiment === 'neutral' ? 1 : 0.85;

export async function loadLearning() { return getLearning(newLearning); }
export async function saveLearning(learning) {
  await changeLearning(newLearning, data => { for (const k of Object.keys(data)) delete data[k]; Object.assign(data, learning); });
}

export function runAnalysis({ feed, learning, state, now }) {
  const e = engineSettings(state.settings);
  const enabled = new Set(state.settings.pairs);
  // Disabled pairs still feed market context and paper learning but can never receive an order.
  const blocked = new Set([...Object.values(state.book ?? {}).map(t => t.symbol), state.pending?.symbol, ...Object.keys(state.positions ?? {}),
    ...Object.keys(feed).filter(symbol => !enabled.has(symbol))].filter(Boolean));
  return analyze({ feed, learning, blocked, now, maxIntents: e.maxEntriesPerCycle + 2 });
}

// Reconcile open protected trades, then dispatch ranked intents. Pushes decisions/trades onto `record`.
export async function runExecution({ id, record, state, engineOut, learning, sentiment, now }) {
  const out = { dispatched: 0, closed: 0, book: 0 };
  const enabled = concurrentEnabled();
  const results = [];
  if (enabled || Object.keys(state.book ?? {}).length) {
    results.push(...await reconcileBook(id, now));
    if (state.pending?.concurrent) results.push(await settlePending(id));
  }
  for (const outcome of closedOutcomes(results)) {
    out.closed++;
    recordLive(learning, outcome, now);
    record.trades.push({ symbol: outcome.symbol, side: 'SELL', status: 'CLOSED', time: outcome.closedAt, quantity: 1, netProfit: outcome.netUsd, feeUsd: outcome.fees ?? 0,
      entryRule: outcome.strategy + ':' + outcome.variant, entryMode: outcome.mode, strategy: engineVersion, reason: 'Protected exit: ' + outcome.exit, price: null });
  }
  const errors = results.filter(r => r?.status === 'error');
  if (errors.length) record.error ??= 'Protected-trade reconciliation incomplete: ' + errors[0].error;
  const mult = sentimentMultiplier(sentiment);
  const cap = engineSettings(state.settings).maxEntriesPerCycle;
  for (const base of engineOut.intents) {
    const intent = { ...base, riskMult: Math.min(1.5, base.riskMult * mult) };
    const decision = { symbol: intent.symbol, side: 'BUY', signal: 'BUY', rule: intent.strategy + ':' + intent.variant, mode: intent.mode, timestamp: timestamp(),
      strategy: engineVersion, commentary: intent.reason, testedRules: [intent.strategy + ':' + intent.variant], regime: intent.regime, estimateR: intent.estimate };
    record.decisions.push(decision);
    if (!enabled) { decision.risk = { accepted: false, code: 'engine-shadow', reason: 'Engine execution is disabled; the signal is tracked as a paper trade' }; continue; }
    if (out.dispatched >= cap) { decision.risk = { accepted: false, code: 'cycle-limit', reason: 'Per-cycle entry limit reached' }; continue; }
    const latest = await getState();
    if (latest.stopped || latest.pending || !executionAllowed(latest)) { decision.risk = { accepted: false, code: 'execution-disabled', reason: 'Execution is stopped, pending or unverified' }; continue; }
    try {
      const result = await dispatchEntry({ leaseId: id, intent, fingerprint: fingerprint(), costs: { slip: learning.costs.slip, costMultiple: learning.guards.costMultiple } });
      decision.risk = result;
      if (result.accepted) {
        out.dispatched++;
        const settled = await settlePending(id);
        if (settled?.status === 'closed') {
          out.closed++; recordLive(learning, settled.outcome, now);
          record.trades.push({ symbol: settled.outcome.symbol, side: 'SELL', status: 'CLOSED', time: settled.outcome.closedAt, quantity: 1, netProfit: settled.outcome.netUsd, feeUsd: settled.outcome.fees ?? 0,
            entryRule: settled.outcome.strategy + ':' + settled.outcome.variant, entryMode: settled.outcome.mode, strategy: engineVersion, reason: 'Protected exit: ' + settled.outcome.exit, price: null });
        }
        if ((await getState()).pending) break;      // unresolved dispatch blocks further entries this cycle
      }
    } catch (error) {
      decision.risk = { accepted: false, code: 'order-service', reason: 'Service unavailable' };
      if ((await getState()).pending) break;
    }
  }
  out.book = Object.keys((await getState()).book ?? {}).length;
  return out;
}

export const engineSnapshot = (engineOut, learning, extra) => ({
  at: timestamp(), version: engineVersion, market: engineOut.market, guards: engineOut.guards, diagnostics: engineOut.diagnostics,
  leaderboard: engineOut.leaderboard.slice(0, 12), recentChanges: learning.changes.slice(-5), journal: learning.journal.slice(-6),
  costs: { slip: learning.costs.slip }, live: learning.live, counters: learning.counters[new Date().toISOString().slice(0, 10)] ?? {}, ...extra
});
