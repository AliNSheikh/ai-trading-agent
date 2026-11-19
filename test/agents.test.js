import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backtest, marketAnalyst, learningAgent, signal } from '../lib/agents.js';
import { parseNews } from '../lib/news.js';
import { defaults, defaultStrategy, inUsd, migrateSettings, periods, validateSettings } from '../lib/settings.js';

const rows = count => Array.from({ length: count }, (_, index) => {
  const start = Date.UTC(2026, 0, 11) + index * 900000;
  const price = 100 + Math.sin(index / 8) * 3 + index * 0.04;
  return [start, price, price + 1, price - 1, price, 20 + index, start + 899999];
});

test('market agent reports technical indicators, volume and volatility from closed candles', () => {
  const bars = rows(140);
  const report = marketAnalyst(bars, defaultStrategy);
  assert.equal(report.price, bars.at(-1)[4]);
  assert.ok(report.rsi >= 0 && report.rsi <= 100);
  assert.ok(report.volatilityPercent > 0);
  assert.ok(report.relativeVolume > 1);
  assert.equal(report.closedAt, new Date(bars.at(-1)[6]).toISOString());
  assert.throws(() => marketAnalyst(bars.slice(5, 14), defaultStrategy), /Insufficient/);
  bars.splice(50, 1);
  assert.throws(() => marketAnalyst(bars, defaultStrategy), /discontinuous/);
});

test('strategy bases position decisions on deterministic rules', () => {
  const context = { price: 100, direction: 'UP', rsi: 54, volume: 1 };
  assert.equal(signal(context, defaultStrategy).side, 'BUY');
  assert.equal(signal({ ...context, rsi: 80 }, defaultStrategy).side, 'HOLD');
  assert.equal(signal({ ...context, price: 96 }, defaultStrategy, { price: 100 }).side, 'SELL');
});

test('learning compares candle runs without altering the strategy or true results', () => {
  const snapshot = { strategy: structuredClone(defaultStrategy), realized: -0.25 };
  const review = learningAgent({ BTCUSDT: rows(150) }, snapshot, 'run', '2026-01-11T00:00:00.000Z');
  assert.equal(review.realizedUsd, -0.25);
  assert.equal(review.sample.closed, 0);
  assert.equal(review.evaluations.length, 3);
  assert.equal(snapshot.strategy.id, defaultStrategy.id);
  assert.deepEqual(review.evaluations[0].results.BTCUSDT, backtest(rows(150), defaultStrategy));
});

test('publisher parser requires canonical HTTPS links, relevance, recent timestamps and unique URL', () => {
  const now = Date.UTC(2026, 0, 11);
  const date = new Date(now).toUTCString();
  const good = '<item><title>Bitcoin market volume</title><link>https://www.coindesk.com/markets/asset?x=1</link><pubDate>' + date + '</pubDate></item>';
  const fake = good.replace('www.coindesk.com/', 'www.coindesk.com.example.org/');
  const stale = good.replace(date, 'Sat, 01 Jan 2022 00:00:00 GMT');
  const result = parseNews('<rss><channel>' + good + good + fake + stale + '</channel></rss>', now);
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://www.coindesk.com/markets/asset');
  assert.throws(() => parseNews('<!DOCTYPE rss [<!ENTITY private SYSTEM "file:///test">]><rss/>'), /DTD prohibited/);
});

test('risk settings migrate prior numeric values and support both amount units', () => {
  const migrated = migrateSettings({ ...defaults, maxPosition: 10, enabled: false, liveTradingEnabled: false, leverage: 1 });
  assert.equal(inUsd(migrated, 'dailyVolume'), 20);
  assert.equal(inUsd(migrated, 'maxPosition'), 10);
  assert.equal(inUsd(migrated, 'riskPerTrade'), 0.5);
  assert.equal(inUsd(migrated, 'dailyLoss'), 2);
  assert.equal(inUsd(migrated, 'monthlyLoss'), 10);
  assert.throws(() => validateSettings({ ...defaults, maxTrades: Infinity }));
  assert.throws(() => validateSettings({ ...defaults, pairs: ['BTCUSD_PERP'] }));
  assert.throws(() => migrateSettings({ ...defaults, enabled: true, liveTradingEnabled: false, leverage: 1 }));
  assert.deepEqual(periods(Date.UTC(2026, 9, 31, 20)), { day: '2026-11-01', month: '2026-11' });
});
