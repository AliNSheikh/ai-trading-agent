import { administer, RequestError } from '../lib/control.js';
import { executionAllowed } from '../lib/orders.js';
import { protectedDemoEnabled } from '../lib/protected-demo.js';
import { entryDiagnostics } from '../lib/entry-diagnostics.js';
import { jsonBody, protect } from '../lib/security.js';
import { goldPairs, hourSlot, hourlyAiLimit, pairs, periods } from '../lib/settings.js';
import { autonomyConfigured, entryRules, orderModel } from '../lib/playbook.js';
import { getState, readData, scope } from '../lib/store.js';
import { qaThrough } from '../lib/qa.js';

export default async function handler(req, res) {
  const admin = await protect(req, res, { mutation: req.method === 'POST' });
  if (!admin) return;
  try {
    if (req.method === 'POST') {
      let body;
      try { body = jsonBody(req); }
      catch { return res.status(400).json({ error: 'Invalid administrator request' }); }
      const result = await administer(body, admin);
      if (result.status === 'busy') return res.status(409).json({ error: 'A research cycle is already running' });
      if (result.status === 'limited') return res.status(429).json({ error: 'Wait a minute before another manual cycle' });
      return res.json(result);
    }
    if (req.method !== 'GET') return res.status(405).end();
    const state = await getState();
    const { day, month } = periods();
    const legacy = req.query?.legacy === '1' ? await readData('journal/events.json') : undefined;
    const model = entry => entry ? {
      id: entry.id, version: entry.version, strategy: entry.strategy, createdAt: entry.createdAt, expiresAt: entry.expiresAt,
      metrics: Object.fromEntries(Object.entries(entry.models).map(([symbol, value]) => [symbol, value.rules ?? value.metrics]))
    } : null;
    return res.json({
      mode: 'binance-demo-spot', csrf: admin.csrf, stopped: state.stopped,
      training: { enabled: protectedDemoEnabled(), dailyExperimentalCap: 1,
        usedToday: state.days[day]?.experimental??0, protection: 'Binance native OPOCO linked exits' },
      readyToResume: executionAllowed(state) && !state.pending, running: state.lease?.until > Date.now(),
      execution: !state.stopped && executionAllowed(state) && !state.pending, withdrawals: false, liveTrading: false,
      settings: state.settings, strategy: state.strategy, positions: state.positions, realized: state.realized,
      performance: state.performance, latest: state.latest, proposal: state.proposal, lastCycle: state.lastCycle,
      pending: state.pending ? { clientId: state.pending.clientId, symbol: state.pending.symbol, time: state.pending.time,
        kind: state.pending.kind??'market', status: state.pending.status,
        orderListId: state.pending.orderListId??null, protectivePlan: state.pending.quote??null } : null,
      day: state.days[day] ?? { volume: 0, trades: 0, loss: 0 }, monthLoss: state.months[month]?.loss ?? 0,
      ai: state.ai[month] ?? { usd: 0, requests: 0, input: 0, output: 0, unconfirmed: 0, days: {} },
      aiCallsToday: state.ai[month]?.days[day] ?? 0,
      aiCallsThisHour: state.ai[month]?.hours?.[hourSlot()] ?? 0, aiHourlyLimit: hourlyAiLimit,
      availablePairs: pairs, goldPairs, entryRules, autonomous: autonomyConfigured(),
      entryDiagnostics: entryDiagnostics(state, {
        autonomous: autonomyConfigured(),
        minNotional: Math.min(...state.settings.pairs
          .map(pair => state.latestQA?.markets?.[pair]?.minimum)
          .filter(value => Number.isFinite(value) && value > 0).concat([5]))
      }),
      connectivityBenchmark: state.connectivityBenchmark ?? null,
      verifiedAt: state.verification?.checkedAt, cronConfigured: (process.env.CRON_SECRET?.length ?? 0) >= 16,
      legacy, environment: scope(), qaThrough, latestQA: state.latestQA ?? null,
      feedback: state.feedback ?? null, activeModel: model(orderModel(state)), modelProposal: model(state.modelProposal),
      managerReports: Object.values(state.managerReports ?? {}).sort((a, b) => b.day.localeCompare(a.day))
    });
  } catch (error) {
    if (error instanceof RequestError) return res.status(error.status).json({ error: error.message });
    return res.status(503).json({ error: 'Demo operation unavailable; check integration health or the journal' });
  }
}
