export const legacyPairs = Object.freeze(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
export const pairs = Object.freeze([
  ...legacyPairs, 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'LINKUSDT', 'LTCUSDT', 'AVAXUSDT',
  'TRXUSDT', 'NEARUSDT', 'SHIBUSDT', 'PEPEUSDT', 'VTHOUSDT', 'PAXGUSDT', 'XAUTUSDT'
]);
export const goldPairs = Object.freeze(['PAXGUSDT', 'XAUTUSDT']);
export const amountKeys = ['dailyVolume', 'maxPosition', 'riskPerTrade', 'dailyLoss', 'monthlyLoss'];
export const orderLimit = 10;
export const dailyAiLimit = 240;
export const hourlyAiLimit = 10;
export const maxRiskPercent = 3;
export const settingsRevision = 'respect-admin-limits-v3';
export const defaultStrategy = Object.freeze({ id: 'sma-rsi-v1', fast: 10, slow: 30, minRsi: 45, maxRsi: 72 });
const usd = value => ({ mode: 'usd', value });
const percent = value => ({ mode: 'percent', value });
export const defaults = Object.freeze({
  capital: 100, dailyVolume: percent(20), maxPosition: usd(10), riskPerTrade: percent(0.5),
  dailyLoss: percent(2), monthlyLoss: percent(10), maxTrades: 3, maxOpenPositions: 2,
  aiMonthlyUsd: 1, aiDailyCalls: 12, pairs: legacyPairs
});

export function validateSettings(input, { stored = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Expected risk settings');
  const { capital, maxTrades, maxOpenPositions, aiMonthlyUsd, aiDailyCalls } = input;
  if (!bounded(capital, 1, 100000) || !integer(maxTrades, 1, stored ? 30 : orderLimit) ||
      !integer(maxOpenPositions, 1, pairs.length) || !bounded(aiMonthlyUsd, 0, 100) || !integer(aiDailyCalls, 0, dailyAiLimit)) {
    throw Error('Invalid capital, count or AI limit');
  }
  const settings = { capital, maxTrades, maxOpenPositions, aiMonthlyUsd, aiDailyCalls };
  for (const key of amountKeys) {
    const { mode, value } = input[key] ?? {};
    const maxPercent = !stored && key === 'riskPerTrade' ? maxRiskPercent : 100;
    if (!['usd', 'percent'].includes(mode) || !bounded(value, 0.01, mode === 'percent' ? maxPercent : maxPercent / 100 * capital)) {
      throw Error('Invalid limit: ' + key + (key === 'riskPerTrade' ? ' (3% of allocation maximum)' : ''));
    }
    settings[key] = { mode, value };
  }
  if (!Array.isArray(input.pairs) || !input.pairs.length || input.pairs.some(pair => !pairs.includes(pair))) {
    throw Error('Invalid trading pairs');
  }
  settings.pairs = pairs.filter(pair => input.pairs.includes(pair));
  return settings;
}

export function authorizedSettings(input) {
  // Deployment updates must never silently raise trade counts, risk percentages,
  // AI request caps, or broaden the administrator's chosen trading pairs.
  return validateSettings(input, { stored: true });
}

export function migrateSettings(input) {
  if (input?.enabled !== false || input.liveTradingEnabled !== false || input.leverage !== 1) {
    throw Error('Legacy risk settings require administrator review');
  }
  const merged = { ...defaults, ...input };
  for (const key of amountKeys) if (typeof merged[key] === 'number') merged[key] = usd(merged[key]);
  return validateSettings(merged, { stored: true });
}

const bounded = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min, max) => Number.isInteger(value) && bounded(value, min, max);
export function inUsd(settings, key) {
  const { mode, value } = settings[key];
  return mode === 'usd' ? value : value / 100 * settings.capital;
}

const calendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit'
});

export function periods(time = Date.now()) {
  const date = calendar.format(time);
  return { day: date, month: date.slice(0, 7) };
}

export const hourSlot = (time = Date.now()) => String(Math.floor(time / 3600000));
