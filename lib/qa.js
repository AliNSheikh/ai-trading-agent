import { chartCandles, rules } from './demo.js';
import { integrationHealth } from './integrations.js';
import { periods } from './settings.js';

export const qaThrough = '2026-11-30';
const qaEnd = Date.parse('2026-12-01T00:00:00+04:00');

export function qaDue(previous, now = Date.now()) {
  const { day } = periods(now);
  return now < qaEnd && (previous?.day !== day ||
    previous.status !== 'passed' && now - Date.parse(previous.completedAt) >= 4 * 3600000);
}

export async function runDemoQA(settings, now) {
  const { day } = periods(now);
  const deployment = process.env.VERCEL_GIT_COMMIT_SHA;
  const verificationId = 'qa-' + day + '-' + (/^[a-f0-9]{40}$/.test(deployment ?? '') ? deployment.slice(0, 12) : 'development');
  const [services, entries] = await Promise.all([
    integrationHealth({ verificationId }),
    Promise.all(settings.pairs.map(async symbol => {
      try {
        const [filters, bars] = await Promise.all([rules(symbol), chartCandles(symbol, '15m', 32)]);
        if (bars.length < 30 || now - bars.at(-1).time > 960000) throw Error();
        return [symbol, { status: 'connected', minimum: filters.minimum, closedBars: bars.length }];
      } catch {
        return [symbol, { status: 'unavailable', reason: 'Demo candle or symbol-filter smoke check failed' }];
      }
    }))
  ]);
  const markets = Object.fromEntries(entries);
  const passed = [...Object.values(services), ...Object.values(markets)].every(item => item.status === 'connected');
  return {
    day, completedAt: new Date().toISOString(), status: passed ? 'passed' : 'degraded', services, markets,
    orderMode: 'Non-executing Binance Demo test order', through: qaThrough
  };
}
