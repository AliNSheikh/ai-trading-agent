import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entryCandidates } from '../lib/playbook.js';
import { evaluateRisk } from '../lib/risk.js';
import { authorizedSettings, defaults, defaultStrategy, periods, validateSettings } from '../lib/settings.js';

test('normal settings enforce risk and count caps while accepting both gold pairs', () => {
  const settings = authorizedSettings(defaults);
  assert.equal(settings.pairs.length, 3);
  assert.equal(settings.aiMonthlyUsd, defaults.aiMonthlyUsd);
  assert.equal(settings.capital, defaults.capital);
  assert.deepEqual(settings.dailyLoss, defaults.dailyLoss);
  assert.throws(() => validateSettings({ ...settings, maxTrades: 11 }));
  assert.throws(() => validateSettings({ ...settings, aiDailyCalls: 241 }));
  assert.throws(() => validateSettings({ ...settings, riskPerTrade: { mode: 'percent', value: 3.001 } }));
  assert.deepEqual(validateSettings({ ...settings, pairs: ['PAXGUSDT', 'XAUTUSDT'] }).pairs, ['PAXGUSDT', 'XAUTUSDT']);
});

test('the fixed playbook detects breakout, trend, pullback and reversion from closed bars', () => {
  const bars = Array.from({ length: 21 }, () => [0, 99, 101, 95, 98]);
  const base = { price: 102, fast: 100, slow: 99, direction: 'UP', rsi: 60, relativeVolume: 1.5, volatilityPercent: 0.6, volume: 22 };
  assert.deepEqual(entryCandidates(bars, base, defaultStrategy).map(rule => rule.rule), ['trend', 'breakout', 'pullback']);
  const range = { ...base, price: 97, fast: 99.8, slow: 100, rsi: 39 };
  bars.at(-2)[4] = 96;
  assert.deepEqual(entryCandidates(bars, range, defaultStrategy).map(rule => rule.rule), ['reversion']);
  assert.deepEqual(entryCandidates(bars, { ...base, volume: 0 }, defaultStrategy), []);
});

test('eligible sizes respect Demo minima plus the fee buffer and daily cap reserves exits', () => {
  const now = Date.UTC(2026, 10, 19, 18);
  const { day } = periods(now);
  const state = { settings: { ...authorizedSettings(defaults), maxTrades: 10, riskPerTrade: { mode: 'percent', value: 3 }, pairs: ['DOGEUSDT', 'PAXGUSDT'] }, stopped: false, pending: null, positions: {},
    realized: 0, days: { [day]: { volume: 0, orders: 0, trades: 0, loss: 0 } }, months: {} };
  const input = { state, verified: true, now, market: { price: 10, closedAt: new Date(now - 1000).toISOString() },
    decision: { side: 'BUY' }, symbol: 'DOGEUSDT',
    rules: { minimum: 1, step: 0.001, minQty: 0.001, maxQty: 20, baseAsset: 'DOGE' },
    wallet: { canTrade: true, balances: [{ asset: 'USDT', free: '100' }], commissionRates: { taker: '0.001', buyer: '0' } } };
  assert.equal(evaluateRisk(input).amount, '1.98');
  assert.match(evaluateRisk({ ...input, symbol: 'PAXGUSDT', rules: { ...input.rules, minimum: 5 } }).reason, /minimum order/);
  state.days[day].orders = 9;
  assert.equal(evaluateRisk(input).code, 'daily-exit-reserve');
  state.days[day].orders = 10;
  assert.equal(evaluateRisk(input).code, 'daily-cap');
});
