export const playbookId = 'demo-spot-playbook-v2';
export const entryRules = Object.freeze({
  trend: 'Trend continuation',
  breakout: 'Volume-confirmed breakout',
  pullback: 'Trend pullback',
  reversion: 'Range mean reversion'
});

export function entryCandidates(rows, market, strategy) {
  const previous = rows.at(-2);
  if (!previous || !Number.isFinite(market.price) || market.volume <= 0) return [];
  const oldClose = Number(previous[4]);
  const rising = market.price > oldClose;
  const ratios = market.relativeVolume ?? 0;
  const spread = (market.fast / market.slow - 1) * 100;
  const priorHigh = Math.max(...rows.slice(-21, -1).map(row => Number(row[2])));
  const priorLow = Math.min(...rows.slice(-21, -1).map(row => Number(row[3])));
  const candidates = [];
  if (market.direction === 'UP' && market.rsi >= strategy.minRsi && market.rsi <= strategy.maxRsi) {
    candidates.push({ rule: 'trend', reason: 'Fast SMA above slow SMA, RSI in range and positive candle volume' });
  }
  if (market.price > priorHigh && ratios >= 1.35 && market.rsi < 82 && market.volatilityPercent <= 2.5) {
    candidates.push({ rule: 'breakout', reason: 'Closed above the prior 20 highs with above-average volume' });
  }
  if (spread > 0 && rising && oldClose <= market.fast && market.price >= market.fast && market.rsi >= 40 && market.rsi <= 66) {
    candidates.push({ rule: 'pullback', reason: 'Price rebounded through the fast SMA within an upward trend' });
  }
  if (Math.abs(spread) <= 0.50 && market.rsi >= 27 && market.rsi <= 44 && rising &&
      market.price <= priorLow + (priorHigh - priorLow) * 0.40 && ratios >= 0.75) {
    candidates.push({ rule: 'reversion', reason: 'Oversold price rebounded near the bottom of a sideways range' });
  }
  return candidates;
}

export function autonomyConfigured() {
  return process.env.VERCEL_ENV === 'production' && process.env.DEMO_EXECUTION_ENABLED === 'true' &&
    process.env.DEMO_AUTONOMOUS_ENABLED === 'true';
}

export function orderModel(state) {
  return autonomyConfigured() && state.autonomousModel?.playbook === playbookId && state.autonomousModel.strategy === state.strategy.id
    ? state.autonomousModel : state.activeModel;
}
