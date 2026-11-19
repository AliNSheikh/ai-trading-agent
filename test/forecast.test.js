import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStrategy } from '../lib/settings.js';
import { collectLessons } from '../lib/review.js';
import { forecastAssessment, forecastVersion, predict, settleForecasts, trainForecast, wilson } from '../lib/forecast.js';
import { qaDue } from '../lib/qa.js';
import { page } from '../lib/dashboard-view.js';

const start = Date.UTC(2026, 10, 4);
const candle = i => {
  const at = start + i * 900000;
  const price = 100 + i * 0.014 + Math.sin(i / 7) * 2;
  return [at, price, price + 1, price - 1, price, 100 + i % 11, at + 899999];
};
const rows = count => Array.from({ length: count }, (_, i) => candle(i));

const artifact = {
  version: forecastVersion, layers: [[10, 9], [6, 11], [1, 7]].map(([nodes, width]) =>
    Array.from({ length: nodes }, () => Array(width).fill(0))),
  buckets: Array.from({ length: 5 }, () => ({ count: 35, wins: 33 }))
};
const model = {
  id: 'approved-fixture', strategy: defaultStrategy.id, expiresAt: new Date(start + 86400000).toISOString(),
  models: { BTCUSDT: { metrics: { qualified: 30, lowerBound: 0.65, meanReturn: 0.005 }, artifact } }
};

test('deep network estimates are bounded and malformed, stale, and unapproved model evidence stays closed', () => {
  assert.equal(predict(artifact, Array(8).fill(0)).probability, 34 / 37);
  assert.equal(predict({ ...artifact, layers: [[[]]] }, Array(8).fill(0)), null);
  assert.equal(predict(artifact, Array(8).fill(Infinity)), null);
  assert.equal(forecastAssessment(null, 'BTCUSDT', rows(41), null, defaultStrategy, start).eligible, false);
  assert.equal(forecastAssessment(model, 'BTCUSDT', rows(41), null, defaultStrategy, start).eligible, true);
  assert.equal(forecastAssessment(model, 'BTCUSDT', rows(41), null, defaultStrategy, start + 86400000).eligible, false);
  assert.equal(forecastAssessment(model, 'ETHUSDT', rows(41), null, defaultStrategy, start).eligible, false);
  assert.ok(wilson(4, 4) < 0.6);
  assert.ok(wilson(27, 30) > 0.6);
});

test('model review requires sufficient closed candles and scores a later purged holdout', () => {
  assert.equal(trainForecast(rows(600), defaultStrategy).status, 'insufficient');
  const data = rows(800);
  const result = trainForecast(data, defaultStrategy, [{ at: data[60][6], net: -0.001 }]);
  assert.ok(result.metrics.train > result.metrics.calibration);
  assert.equal(result.metrics.reviewedMistakes, 1);
  assert.ok(result.metrics.holdoutFrom > result.metrics.from);
  assert.ok(result.metrics.through <= new Date(data.at(-1)[6]).toISOString());
  assert.ok(result.metrics.qualified <= result.metrics.holdout);
  assert.deepEqual(result, trainForecast(data, defaultStrategy, [{ at: data[60][6], net: -0.001 }]));
});

test('forecast labels use only later observed candles and subtract the round-trip fee', () => {
  const data = rows(58);
  const pending = [{ symbol: 'BTCUSDT', at: data[45][6], probability: 0.83 }];
  const scored = settleForecasts(pending, { BTCUSDT: data });
  assert.equal(scored.remaining.length, 0);
  assert.equal(scored.resolved[0].net, data[50][1] / data[46][1] - 1 - 0.004);
  assert.equal(settleForecasts(pending, { BTCUSDT: data.slice(0, 49) }).resolved.length, 0);
});

test('error feedback records recurring agent failures and loses no P&L attribution in reviewed fills', () => {
  const record = {
    startedAt: '2026-11-19T19:00:00Z', agents: [{ agent: 'News Analyst', status: 'unavailable', error: 'Provider timeout' }],
    trades: [{ symbol: 'BTCUSDT', netProfit: -0.02, strategy: defaultStrategy.id, feeUsd: 0.015, time: '2026-11-19T19:00:00Z' }]
  };
  const first = collectLessons({}, record);
  const next = collectLessons(first, { ...record, trades: [] });
  assert.equal(next.errors[0].count, 2);
  assert.equal(next.losses[0].net, -0.02);
  assert.match(next.losses[0].lesson, /fee drag/);
});

test('dated Demo QA continues to the end of November 30 GST and retries degraded checks after four hours', () => {
  const first = Date.parse('2026-11-30T03:00:00+04:00');
  const failed = { day: '2026-11-30', completedAt: new Date(first).toISOString(), status: 'degraded' };
  assert.equal(qaDue(null, first), true);
  assert.equal(qaDue(failed, first + 3600000), false);
  assert.equal(qaDue(failed, first + 4 * 3600000), true);
  assert.equal(qaDue(null, Date.parse('2026-11-30T23:59:59+04:00')), true);
  assert.equal(qaDue(null, Date.parse('2026-12-01T00:00:00+04:00')), false);
});

test('dashboard browser code parses and six desk figures stay out of the public sign-in page', () => {
  const dashboard = page('nonce', true);
  assert.equal((dashboard.match(/class="desk desk-/g) ?? []).length, 6);
  assert.match(dashboard, /id="market-chart"/);
  assert.doesNotMatch(page('nonce', false), /id="market-chart"/);
  const script = dashboard.slice(dashboard.indexOf('>', dashboard.indexOf('<script')) + 1, dashboard.indexOf('</script>'));
  assert.doesNotThrow(() => new Function(script));
});
