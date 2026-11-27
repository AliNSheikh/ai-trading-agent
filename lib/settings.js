export const legacyPairs = Object.freeze(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
export const pairs = Object.freeze([
  ...legacyPairs, 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'LINKUSDT', 'LTCUSDT', 'AVAXUSDT',
  'TRXUSDT', 'NEARUSDT', 'SHIBUSDT', 'PEPEUSDT', 'VTHOUSDT', 'PAXGUSDT', 'XAUTUSDT'
]);
export const goldPairs = Object.freeze(['PAXGUSDT', 'XAUTUSDT']);
export const amountKeys = ['dailyVolume', 'maxPosition', 'riskPerTrade', 'dailyLoss', 'monthlyLoss'];
export const orderLimit = 60;
export const dailyAiLimit = 240;
export const hourlyAiLimit = 10;
export const maxRiskPercent = 3;
export const settingsRevision = 'multi-strategy-v4';
export const defaultStrategy = Object.freeze({ id: 'sma-rsi-v1', fast: 10, slow: 30, minRsi: 45, maxRsi: 72 });
const usd = value => ({ mode: 'usd', value });
const percent = value => ({ mode: 'percent', value });
export const engineDefaults = Object.freeze({
  enabled: true, maxConcurrent: 4, entriesPerDay: 16, probesPerDay: 6, maxEntriesPerCycle: 2,
  maxPerFamily: 2, heatPercent: 2.5, timeStops: true
});
const engineBounds = { maxConcurrent: [1, 10], entriesPerDay: [1, 100], probesPerDay: [0, 50], maxEntriesPerCycle: [1, 5], maxPerFamily: [1, 5] };
export const engineSettings = settings => ({ ...engineDefaults, ...(settings?.engine ?? {}) });
function validateEngine(input) {
  if (input == null) return { ...engineDefaults };
  if (typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid engine settings');
  const merged = { ...engineDefaults, ...input }, out = {};
  for (const [key, [lo, hi]] of Object.entries(engineBounds)) {
    if (!Number.isInteger(merged[key]) || merged[key] < lo || merged[key] > hi) throw Error('Invalid engine limit: ' + key);
    out[key] = merged[key];
  }
  if (!bounded(merged.heatPercent, 0.1, 10) || typeof merged.enabled !== 'boolean' || typeof merged.timeStops !== 'boolean') throw Error('Invalid engine limit');
  return { enabled: merged.enabled, ...out, heatPercent: merged.heatPercent, timeStops: merged.timeStops };
}
export const defaults = Object.freeze({
  capital: 100, dailyVolume: percent(20), maxPosition: usd(10), riskPerTrade: percent(0.5),
  dailyLoss: percent(2), monthlyLoss: percent(10), maxTrades: 3, maxOpenPositions: 2,
  aiMonthlyUsd: 1, aiDailyCalls: 12, pairs: legacyPairs
});

export function validateSettings(input, { stored = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Expected risk settings');
  const { capital, maxTrades, maxOpenPositions, aiMonthlyUsd, aiDailyCalls } = input;
  if (!bounded(capital, 1, 100000) || !integer(maxTrades, 1, stored ? 200 : orderLimit) ||
      !integer(maxOpenPositions, 1, pairs.length) || !bounded(aiMonthlyUsd, 0, 100) || !integer(aiDailyCalls, 0, dailyAiLimit)) {
    throw Error('Invalid capital, count or AI limit');
  }
  const settings = { capital, maxTrades, maxOpenPositions, aiMonthlyUsd, aiDailyCalls };
  for (const key of amountKeys) {
    const { mode, value } = input[key] ?? {};
    const maxPercent = !stored && key === 'riskPerTrade' ? maxRiskPercent : key === 'dailyVolume' ? 1000 : 100;
    if (!['usd', 'percent'].includes(mode) || !bounded(value, 0.01, mode === 'percent' ? maxPercent : maxPercent / 100 * capital)) {
      throw Error('Invalid limit: ' + key + (key === 'riskPerTrade' ? ' (3% of allocation maximum)' : ''));
    }
    settings[key] = { mode, value };
  }
  if (!Array.isArray(input.pairs) || !input.pairs.length || input.pairs.some(pair => !pairs.includes(pair))) {
    throw Error('Invalid trading pairs');
  }
  settings.pairs = pairs.filter(pair => input.pairs.includes(pair));
  settings.engine = validateEngine(input.engine);
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

// One-time, audited release migration (recorded in state.settingsRelease). It only ever RAISES capacity limits that
// blocked multi-trade operation and never raises loss limits. Risk per trade becomes a true stop-distance risk.
export function multiStrategyMigration(settings) {
  const capital = settings.capital;
  const usdValue = key => inUsd(settings, key);
  return validateSettings({
    ...settings,
    maxTrades: Math.max(settings.maxTrades, 40),
    maxOpenPositions: Math.max(settings.maxOpenPositions, 4),
    maxPosition: usd(Math.max(usdValue('maxPosition'), Math.min(capital, 0.25 * capital))),
    dailyVolume: percent(Math.max(settings.dailyVolume.mode === 'percent' ? settings.dailyVolume.value : usdValue('dailyVolume') / capital * 100, 600)),
    riskPerTrade: percent(0.5),
    engine: { ...engineDefaults, ...(settings.engine ?? {}) }
  }, { stored: true });
}
