export const pairs = Object.freeze(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
export const amountKeys = ['dailyVolume', 'maxPosition', 'riskPerTrade', 'dailyLoss', 'monthlyLoss'];
export const defaultStrategy = Object.freeze({ id: 'sma-rsi-v1', fast: 10, slow: 30, minRsi: 45, maxRsi: 72 });
const usd = value => ({ mode: 'usd', value });
const percent = value => ({ mode: 'percent', value });
export const defaults = Object.freeze({
  capital: 100, dailyVolume: percent(20), maxPosition: usd(10), riskPerTrade: percent(0.5),
  dailyLoss: percent(2), monthlyLoss: percent(10), maxTrades: 3, maxOpenPositions: 2,
  aiMonthlyUsd: 1, aiDailyCalls: 12, pairs
});

export function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Expected risk settings');
  const { capital, maxTrades, maxOpenPositions, aiMonthlyUsd, aiDailyCalls } = input;
  if (!bounded(capital, 1, 100000) || !integer(maxTrades, 1, 30) || !integer(maxOpenPositions, 1, pairs.length) ||
      !bounded(aiMonthlyUsd, 0, 100) || !integer(aiDailyCalls, 0, 50)) throw Error('Invalid capital, count or AI limit');
  const settings = { capital, maxTrades, maxOpenPositions, aiMonthlyUsd, aiDailyCalls };
  for (const key of amountKeys) {
    const { mode, value } = input[key] ?? {};
    if (!['usd', 'percent'].includes(mode) || !bounded(value, 0.01, mode === 'percent' ? 100 : capital)) {
      throw Error('Invalid limit: ' + key);
    }
    settings[key] = { mode, value };
  }
  if (!Array.isArray(input.pairs) || !input.pairs.length || input.pairs.some(pair => !pairs.includes(pair))) {
    throw Error('Invalid trading pairs');
  }
  settings.pairs = [...new Set(input.pairs)];
  return settings;
}

export function migrateSettings(input) {
  if (input?.enabled !== false || input.liveTradingEnabled !== false || input.leverage !== 1) {
    throw Error('Legacy risk settings require administrator review');
  }
  const merged = { ...defaults, ...input };
  for (const key of amountKeys) if (typeof merged[key] === 'number') merged[key] = usd(merged[key]);
  return validateSettings(merged);
}

const bounded = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min, max) => Number.isInteger(value) && bounded(value, min, max);
export function inUsd(settings, key) {
  const { mode, value } = settings[key];
  return mode === 'usd' ? value : value / 100 * settings.capital;
}

export function periods(time = Date.now()) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(time);
  return { day: date, month: date.slice(0, 7) };
}
