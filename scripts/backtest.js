#!/usr/bin/env node
// Walk-forward backtest of the live multi-strategy engine on real Binance candles (public endpoint, no keys).
//   node scripts/backtest.js                       -> 17 pairs, ~60 days, 0.10% fee + 0.05% slippage per side
//   node scripts/backtest.js --days 90 --slip 0.001 --pairs BTCUSDT,ETHUSDT,SOLUSDT
//   node scripts/backtest.js --synthetic           -> offline smoke test on generated data (NOT evidence of edge)
import { replay, summarizeOutcomes } from '../lib/engine.js';
import { costDefaults } from '../lib/shadow.js';
import { pairs } from '../lib/settings.js';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : process.argv[i + 1] ?? true; };
const days = Number(arg('days', 60)), fee = Number(arg('fee', costDefaults.fee)), slip = Number(arg('slip', costDefaults.slip));
const symbols = String(arg('pairs', pairs.join(','))).split(',').filter(Boolean);
if (!symbols.includes('BTCUSDT')) symbols.unshift('BTCUSDT');
const host = process.env.BINANCE_DATA_HOST ?? 'https://data-api.binance.vision';

async function history(symbol) {
  const need = days * 96, out = [];
  let end = Date.now();
  while (out.length < need) {
    const url = host + '/api/v3/klines?symbol=' + symbol + '&interval=15m&limit=1000&endTime=' + end;
    const response = await fetch(url);
    if (!response.ok) throw Error(symbol + ' klines HTTP ' + response.status);
    const rows = await response.json();
    if (!rows.length) break;
    out.unshift(...rows); end = rows[0][0] - 1;
  }
  const now = Date.now();
  return out.filter(r => r[6] < now).slice(-need);
}

let feed;
if (arg('synthetic', false)) {
  const { synth } = await import('../test/support/synth.js');
  feed = synth(symbols.slice(0, 12).length > 3 ? symbols.slice(0, 12) : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT'], days * 96, 'backtest');
} else {
  feed = {};
  for (const s of symbols) { try { feed[s] = await history(s); process.stderr.write('loaded ' + s + ' ' + feed[s].length + '\n'); } catch (e) { process.stderr.write('skipped ' + s + ': ' + e.message + '\n'); } }
}

if (arg('synthetic', false)) console.log('\n*** SYNTHETIC DATA: trends are built in, so results below only prove the code runs. They are NOT evidence of edge. ***');
const outcomes = replay(feed, { costs: { fee, slip, spread: 0 } });
if (!outcomes.length) { console.log('No trades were generated. Check the data window.'); process.exit(0); }
const split = outcomes[Math.floor(outcomes.length * 0.6)].exitAt;
const train = outcomes.filter(o => o.exitAt <= split), test = outcomes.filter(o => o.exitAt > split);
const trainStats = summarizeOutcomes(train), testStats = summarizeOutcomes(test);
console.log('\nTrades: ' + outcomes.length + ' over ' + days + ' days (' + (outcomes.length / days).toFixed(1) + '/day across ' + Object.keys(feed).length + ' pairs)');
console.log('Costs per side: fee ' + (fee * 100).toFixed(2) + '% + slippage ' + (slip * 100).toFixed(2) + '%\n');
const rows = Object.keys(trainStats).sort().map(k => ({
  strategy: k, trainN: trainStats[k].n, trainExpR: trainStats[k].expectancyR, testN: testStats[k]?.n ?? 0, testExpR: testStats[k]?.expectancyR ?? null,
  testWin: testStats[k]?.winRate ?? null, testNetPct: testStats[k]?.avgNetPct ?? null, testT: testStats[k]?.tStat ?? null,
  verdict: testStats[k] && testStats[k].n >= 20 && trainStats[k].expectancyR > 0 && testStats[k].expectancyR > 0 && testStats[k].tStat > 1.5 ? 'PASS' : 'FAIL'
}));
console.table(rows);
const all = outcomes.reduce((s, o) => s + o.r, 0) / outcomes.length;
console.log('Portfolio mean R per trade (all variants, unweighted): ' + all.toFixed(3));
console.log('A strategy is only worth enabling live if it PASSES: positive expectancy in BOTH halves, n>=20 out-of-sample, t-stat>1.5.');
console.log('Re-run with --slip 0.001 to stress costs; an edge that disappears at 2x slippage is not robust.');
