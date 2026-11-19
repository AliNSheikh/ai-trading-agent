import { createHash, randomUUID } from 'node:crypto';
import { learningAgent, marketAnalyst, names, newsAnalyst, signal, strategyAgent } from './agents.js';
import { candles } from './demo.js';
import { forecastAssessment, settleForecasts } from './forecast.js';
import { applyFill, evaluateOrder, resolvePending } from './orders.js';
import { qaDue, runDemoQA } from './qa.js';
import { collectLessons, managerReport, modelReview } from './review.js';
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

function explain({ side, reason, forecast }) {
  if (side === 'HOLD') return reason;
  if (side === 'BUY' && forecast) return forecast.reason + '. ' + reason;
  return reason;
}

async function strategyReview(input, state, id, source) {
  if (!input.candidates.length) throw Error('Current Demo market data required');
  if (input.candidates.every(item => item.side === 'HOLD') && source !== 'admin') {
    return { output: { explanation: 'No pair met an entry or exit rule', weakness: 'Continue monitoring pair-specific reasons' } };
  }
  if (!input.sentiment) throw Error('Verified news sentiment unavailable');
  const key = createHash('sha256').update(JSON.stringify([
    input.rules.id, input.sentiment, input.candidates.map(({ symbol, side }) => [symbol, side])
  ])).digest('hex');
  const memory = state.latest[names[2]];
  const prior = memory?.output;
  const original = prior?.reusedFrom ?? memory?.at;
  if (prior?.cacheKey === key && Date.now() - Date.parse(original) < 2 * 3600000) {
    return { output: { ...prior, reusedFrom: original } };
  }
  const result = await strategyAgent(input, id);
  if (result.output) result.output.cacheKey = key;
  return result;
}

export async function runCycle(source, requestId = randomUUID()) {
  const now = Date.now();
  const { day } = periods(now);
  const hour = Math.floor(now / 3600000);
  const automatic = source === 'schedule' || source === 'preview-verification';
  const scheduledKey = source === 'preview-verification' ? 'previewHour' : 'researchHour';
  const slot = source === 'preview-verification' ? hour + ':' + process.env.VERCEL_GIT_COMMIT_SHA : hour;
  const id = randomUUID();
  const acquired = await changeState(state => {
    if (state.lease?.until > now) return { unchanged: true, value: { status: 'busy' } };
    if ((automatic && state.lastScheduled[scheduledKey] === slot) || state.operations[requestId]) {
      return { unchanged: true, value: { status: 'duplicate' } };
    }
    if (source === 'admin' && state.lastManualCycle > now - 60000) return { unchanged: true, value: { status: 'limited' } };
    state.lease = { id, until: now + leaseLength };
    for (const [key, entry] of Object.entries(state.operations)) if (entry.time < now - 86400000) delete state.operations[key];
    state.operations[requestId] = { time: now, action: 'research', cycle: id };
    if (automatic) state.lastScheduled[scheduledKey] = slot;
    if (source === 'admin') state.lastManualCycle = now;
    return { status: 'started', state };
  });
  if (acquired.status !== 'started') return { status: acquired.status };
  const state = acquired.state;
  const record = {
    id, previous: state.head, startedAt: timestamp(), source, mode: 'binance-demo-spot',
    strategy: state.strategy, agents: [], decisions: [], trades: [], forecastResults: [], qa: null, error: null
  };
  let reconciliation = null;
  let review = null;
  let modelProposal = null;
  let queued = state.forecastQueue ?? [];
  // Automatic cycles run the dated checks. Manual research remains a fast operation.
  const qa = automatic && qaDue(state.latestQA, now) ? runDemoQA(state.settings, now).catch(() => ({
    day, deployment: process.env.VERCEL_GIT_COMMIT_SHA, completedAt: timestamp(), status: 'degraded', error: 'Demo QA could not finish'
  })) : null;
  try {
    if (state.pending) {
      reconciliation = await resolvePending(state, id);
      await runAgent(record, names[3], { clientId: state.pending.clientId }, () => ({
        output: { reason: 'Reconciled an existing order reservation before further research' }
      }));
    } else {
      let feed = {};
      const marketTask = runAgent(record, names[0], { pairs: state.settings.pairs, interval: '15m' }, async setInput => {
        feed = Object.fromEntries(await Promise.all(state.settings.pairs.map(async pair => [pair, await candles(pair)])));
        setInput({ pairs: Object.keys(feed), interval: '15m', samples: Object.fromEntries(
          Object.entries(feed).map(([pair, rows]) => [pair, { size: rows.length, last: rows.at(-1)?.[6] }])
        ) });
        return { output: Object.fromEntries(Object.entries(feed).map(([pair, rows]) => [pair, marketAnalyst(rows, state.strategy)])) };
      });
      const newsTask = runAgent(record, names[1], {}, setInput => newsAnalyst(id, setInput, state.latest[names[1]]));
      const [market, news] = await Promise.all([marketTask, newsTask]);
      let candidates = [];
      if (market.output) {
        const observed = settleForecasts(queued, feed);
        record.forecastResults = observed.resolved;
        queued = observed.remaining;
        candidates = Object.entries(market.output).filter(([, item]) => Date.now() - Date.parse(item.closedAt) < 960000)
          .map(([symbol, overview]) => {
            const decision = signal(overview, state.strategy, state.positions[symbol]);
            const forecast = decision.side === 'BUY' ?
              forecastAssessment(state.activeModel, symbol, feed[symbol], overview, state.strategy) : null;
            const at = Date.parse(overview.closedAt);
            if (forecast?.eligible && !queued.some(item => item.symbol === symbol && item.at === at) &&
                !record.forecastResults.some(item => item.symbol === symbol && item.at === at)) {
              queued.push({ symbol, at, model: forecast.model, probability: forecast.probability });
            }
            return { symbol, ...decision, forecast };
          }).sort((a, b) => (Number(b.side === 'SELL') - Number(a.side === 'SELL')) ||
            ((b.forecast?.probability ?? 0) - (a.forecast?.probability ?? 0)));
      }
      const strategyInput = {
        rules: state.strategy, market: market.output,
        candidates: candidates.map(({ symbol, side, reason }) => ({ symbol, side, reason })),
        holdings: Object.fromEntries(Object.entries(state.positions).map(([pair, position]) => [pair, { entry: position.price }])),
        sentiment: news.output?.sentiment ?? null,
        previousWeakness: state.latest[names[2]]?.output?.weakness?.slice(0, 120) ?? null
      };
      const strategyTask = runAgent(record, names[2], strategyInput, () => strategyReview(strategyInput, state, id, source));
      const learningDue = state.latestReviewDay !== day || state.latestReviewStrategy !== state.strategy.id;
      const learningTask = learningDue ? runAgent(record, names[4], {
        day, strategy: state.strategy.id, realizedUsd: state.realized, reviewedForecasts: state.lessons?.length ?? 0
      }, async () => {
        if (!market.output) throw Error('Demo candles unavailable for backtesting');
        const previous = [...(state.lessons ?? []), ...record.forecastResults];
        const neural = await modelReview({ ...state, lessons: previous }, id, feed, now);
        modelProposal = neural.proposal;
        review = {
          ...learningAgent(feed, state, id, timestamp()), neural: neural.report, failures: state.feedback?.errors ?? [],
          losses: state.feedback?.losses ?? [], forecastSample: previous.length
        };
        return { output: review };
      }) : null;

      const strategy = await strategyTask;
      const risk = await runAgent(record, names[3], { settings: state.settings, strategy: state.strategy.id }, async () => {
        if (!candidates.length) throw Error('Current Demo market data required');
        let dispatched = false;
        const advisoryOK = Boolean(strategy.output && news.output?.sentiment && news.output.sentiment !== 'negative');
        for (const candidate of candidates) {
          const decision = { ...candidate, timestamp: timestamp(), strategy: state.strategy.id, commentary: explain(candidate) };
          record.decisions.push(decision);
          if (decision.side === 'HOLD') {
            decision.risk = { accepted: false, code: 'hold', reason: 'No order proposed' };
          } else if (dispatched) {
            decision.risk = { accepted: false, code: 'cycle-limit', reason: 'One order per research cycle' };
          } else if (decision.side === 'BUY' && !decision.forecast?.eligible) {
            decision.risk = { accepted: false, code: 'forecast', reason: decision.forecast?.reason ?? 'Approved forecast required' };
          } else if (decision.side === 'BUY' && !advisoryOK) {
            decision.risk = { accepted: false, code: 'advisory', reason: 'Current positive, neutral, or mixed news and strategy review required' };
          } else {
            decision.risk = await evaluateOrder({
              leaseId: id, symbol: candidate.symbol, decision, market: market.output[candidate.symbol], prerequisites: true
            });
          }
          if (decision.risk.clientId) dispatched = true;
        }
        return { output: { evaluated: record.decisions.length, dispatchCount: Number(dispatched) } };
      });
      await learningTask;
      if (risk.error) record.error = risk.error;
      const latest = await getState();
      if (latest.pending) reconciliation = await resolvePending(latest, id);
      if (!market.output || !strategy.output || !news.output?.sentiment) {
        record.error ??= 'Required entry research services unavailable; exit evaluation remains independent';
      }
    }
  } catch (error) {
    record.error = errorText(error);
  }
  if (qa) record.qa = await qa;
  for (const name of names.slice(0, -1)) {
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
  const feedback = collectLessons(state.feedback, record);
  const manager = await runAgent(record, names[5], {
    day, priorCycles: state.managerReports?.[day]?.cycles ?? 0, strategy: state.strategy.id
  }, () => ({ output: managerReport(state, record, feedback) }));
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
      latest.latestReviewStrategy = latest.strategy.id;
      if (review.proposal && !latest.proposal && review.proposal.parent === latest.strategy.id) latest.proposal = review.proposal;
      if (modelProposal?.strategy === latest.strategy.id &&
          (!latest.modelProposal || Date.parse(latest.modelProposal.expiresAt) <= now)) latest.modelProposal = modelProposal;
    }
    latest.forecastQueue = queued.slice(-96);
    latest.lessons = [...(latest.lessons ?? []), ...record.forecastResults].slice(-200);
    latest.feedback = feedback;
    if (record.qa) latest.latestQA = record.qa;
    if (manager.output) {
      latest.managerReports ??= {};
      latest.managerReports[day] = manager.output;
      for (const old of Object.keys(latest.managerReports).sort().slice(0, -35)) delete latest.managerReports[old];
    }
    latest.head = id;
    latest.lease = null;
    latest.lastCycle = { status: record.error ? 'degraded' : 'completed', at: record.finishedAt, error: record.error };
    return latest.lastCycle;
  });
  return { id, status: record.error ? 'degraded' : 'completed', ...(record.qa ? { qa: record.qa.status } : {}) };
}
