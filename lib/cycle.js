import { randomUUID } from 'node:crypto';
import { learningAgent, marketAnalyst, names, newsAnalyst, signal, strategyAgent } from './agents.js';
import { candles } from './demo.js';
import { applyFill, evaluateOrder, resolvePending } from './orders.js';
import { periods } from './settings.js';
import { appendRun, changeState, getState } from './store.js';

const leaseLength = 240000;
const timestamp = () => new Date().toISOString();
const errorText = error => error instanceof Error && /^[a-z0-9][a-z0-9 .:;()_-]{0,180}$/i.test(error.message)
  ? error.message : 'Service unavailable';

async function runAgent(record, name, inputs, perform) {
  const row = { agent: name, startedAt: timestamp(), inputs, output: null, error: null, usage: null };
  record.agents.push(row);
  try {
    const result = await perform(value => { row.inputs = value; });
    row.output = result.output ?? null;
    row.error = result.error ?? null;
    row.usage = result.usage ?? null;
  } catch (error) {
    row.error = errorText(error);
  } finally {
    row.finishedAt = timestamp();
    row.status = row.error ? 'unavailable' : 'complete';
  }
  return row;
}

export async function runCycle(source, requestId = randomUUID()) {
  const now = Date.now();
  const { day } = periods(now);
  const id = randomUUID();
  const acquired = await changeState(state => {
    if (state.lease?.until > now) return { unchanged: true, value: { status: 'busy' } };
    if (source === 'schedule' && state.lastScheduled.research === day || state.operations[requestId]) {
      return { unchanged: true, value: { status: 'duplicate' } };
    }
    if (source === 'admin' && state.lastManualCycle > now - 60000) return { unchanged: true, value: { status: 'limited' } };
    state.lease = { id, until: now + leaseLength };
    for (const [key, entry] of Object.entries(state.operations)) if (entry.time < now - 86400000) delete state.operations[key];
    state.operations[requestId] = { time: now, action: 'research', cycle: id };
    if (source === 'schedule') state.lastScheduled.research = day;
    if (source === 'admin') state.lastManualCycle = now;
    return { status: 'started', state };
  });
  if (acquired.status !== 'started') return { status: acquired.status };
  const state = acquired.state;
  const record = {
    id, previous: state.head, startedAt: timestamp(), source, mode: 'binance-demo-spot',
    strategy: state.strategy, agents: [], decisions: [], trades: [], error: null
  };
  let reconciliation = null;
  let review = null;
  try {
    if (state.pending) {
      reconciliation = await resolvePending(state, id);
      await runAgent(record, names[3], { clientId: state.pending.clientId }, () => ({
        output: { reason: 'Reconciled an existing order reservation before further research' }
      }));
    } else {
      let feed = {};
      const market = await runAgent(record, names[0], { pairs: state.settings.pairs, interval: '15m' }, async setInput => {
        feed = Object.fromEntries(await Promise.all(state.settings.pairs.map(async pair => [pair, await candles(pair)])));
        setInput({ pairs: Object.keys(feed), interval: '15m', samples: Object.fromEntries(
          Object.entries(feed).map(([pair, rows]) => [pair, { size: rows.length, last: rows.at(-1)?.[6] }])
        ) });
        return { output: Object.fromEntries(Object.entries(feed).map(([pair, rows]) => [pair, marketAnalyst(rows, state.strategy)])) };
      });
      const news = await runAgent(record, names[1], {}, setInput => newsAnalyst(id, setInput, state.latest[names[1]]));
      let candidates = [];
      if (market.output && Object.values(market.output).every(item => now - Date.parse(item.closedAt) < 960000)) {
        candidates = Object.entries(market.output).map(([symbol, overview]) => ({
          symbol, ...signal(overview, state.strategy, state.positions[symbol])
        })).sort((a, b) => Number(b.side === 'SELL') - Number(a.side === 'SELL'));
      }
      const strategyInput = {
        version: state.strategy.id, market: market.output, candidates, sentiment: news.output?.sentiment ?? null,
        previousWeakness: state.latest[names[2]]?.output?.weakness ?? null
      };
      const strategy = await runAgent(record, names[2], strategyInput, async () => {
        if (!candidates.length || !news.output?.sentiment) throw Error('Current market and verified news sentiment required');
        return strategyAgent(strategyInput, id);
      });
      const risk = await runAgent(record, names[3], { settings: state.settings, strategy: state.strategy.id }, async () => {
        if (!candidates.length) throw Error('Current Demo market data required');
        const armed = Boolean(strategy.output && news.output?.sentiment);
        let dispatched = false;
        for (const candidate of candidates) {
          const decision = {
            ...candidate, timestamp: timestamp(), strategy: state.strategy.id,
            commentary: strategy.output?.explanation ?? null
          };
          record.decisions.push(decision);
          decision.risk = dispatched ? { accepted: false, reason: 'One order per research cycle' } :
            await evaluateOrder({
              leaseId: id, symbol: candidate.symbol, decision, market: market.output[candidate.symbol],
              prerequisites: armed
            });
          if (decision.risk.clientId) dispatched = true;
        }
        return { output: { evaluated: record.decisions.length, dispatchCount: Number(dispatched) } };
      });
      if (risk.error) record.error = risk.error;

      if (state.latestReviewDay !== day) {
        const learned = await runAgent(record, names[4], { day, strategy: state.strategy.id, realizedUsd: state.realized }, async () => {
          if (!market.output) throw Error('Demo candles unavailable for backtesting');
          const result = learningAgent(feed, state, id, timestamp());
          review = result;
          return { output: result };
        });
        if (learned.error) record.error ??= learned.error;
      }
      const latest = await getState();
      if (latest.pending) reconciliation = await resolvePending(latest, id);
      if (!market.output || !strategy.output || !news.output?.sentiment) {
        record.error ??= 'Required research services unavailable; execution skipped';
      }
    }
  } catch (error) {
    record.error = errorText(error);
  }
  for (const name of names) {
    if (!record.agents.some(row => row.agent === name)) {
      record.agents.push({
        agent: name, startedAt: record.startedAt, finishedAt: timestamp(), status: 'skipped',
        inputs: null, output: null, error: record.error ?? 'Scheduled review already completed or reconciliation-only cycle', usage: null
      });
    }
  }
  if (reconciliation) {
    try {
      const fill = applyFill(structuredClone(await getState()), reconciliation);
      if (fill) record.trades.push(fill);
    } catch (error) {
      record.error = errorText(error);
      reconciliation = null;
    }
  }
  record.finishedAt = timestamp();
  await appendRun(id, record);
  await changeState(latest => {
    if (latest.lease?.id !== id || latest.lease.until <= Date.now()) throw Error('Research lease expired before journaling');
    if (reconciliation) applyFill(latest, reconciliation);
    for (const agent of record.agents) {
      if (agent.status !== 'skipped') latest.latest[agent.agent] = {
        run: id, at: agent.finishedAt, status: agent.status, output: agent.output, error: agent.error
      };
    }
    if (review) {
      latest.latestReviewDay = day;
      if (review.proposal && !latest.proposal && review.proposal.parent === latest.strategy.id) latest.proposal = review.proposal;
    }
    latest.head = id;
    latest.lease = null;
    latest.lastCycle = { status: record.error ? 'degraded' : 'completed', at: record.finishedAt, error: record.error };
    return latest.lastCycle;
  });
  return { id, status: record.error ? 'degraded' : 'completed' };
}
