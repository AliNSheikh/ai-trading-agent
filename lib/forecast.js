import { marketAnalyst } from './agents.js';

export const forecastVersion = 'mlp-8-10-6-v1';
export const horizon = 4;
export const threshold = 0.72;
const roundTripFee = 0.004;
const minimumEvidence = 20;
const cap = value => Math.max(-3, Math.min(3, value));
const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));

export function features(rows, strategy, suppliedMarket) {
  const market = suppliedMarket ?? marketAnalyst(rows, strategy);
  const move = bars => market.price / Number(rows.at(-1 - bars)[4]) - 1;
  const bar = rows.at(-1);
  return [
    cap((market.fast / market.slow - 1) * 100), cap((market.rsi - 50) / 15),
    cap(market.volatilityPercent * 2), cap(Math.log(market.relativeVolume || 1)),
    cap(move(1) * 120), cap(move(4) * 80), cap(move(16) * 45),
    cap((Number(bar[2]) - Number(bar[3])) / market.price * 100)
  ];
}

function network(seed) {
  let state = seed;
  const weight = () => ((state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 4294967296 - 0.5) * 0.5;
  const layer = (inputs, outputs) => Array.from({ length: outputs }, () => Array.from({ length: inputs + 1 }, weight));
  return [layer(8, 10), layer(10, 6), layer(6, 1)];
}

function forward(layers, input) {
  const activations = [input];
  for (const [index, layer] of layers.entries()) {
    const transform = index === layers.length - 1 ? sigmoid : Math.tanh;
    const values = activations.at(-1);
    activations.push(layer.map(weights => transform(weights.reduce(
      (sum, weight, i) => sum + weight * (i === values.length ? 1 : values[i]), 0
    ))));
  }
  return activations;
}

function gradient(layers, sample, rate, mistakeWeight) {
  const activations = forward(layers, sample.input);
  const delta = [[(activations.at(-1)[0] - sample.target) * mistakeWeight]];
  for (let depth = layers.length - 1; depth > 0; depth--) {
    delta.unshift(activations[depth].map((value, j) =>
      (1 - value ** 2) * layers[depth].reduce((sum, w, i) => sum + w[j] * delta[0][i], 0)
    ));
  }
  for (const [depth, layer] of layers.entries()) {
    const input = activations[depth];
    for (const [node, weights] of layer.entries()) {
      for (let j = 0; j < weights.length; j++) {
        weights[j] -= rate * (delta[depth][node] * (j < input.length ? input[j] : 1) + 0.001 * weights[j]);
      }
    }
  }
}

function outcome(open, exit) {
  return Number.isFinite(open) && Number.isFinite(exit) && open > 0 && exit > 0
    ? exit / open - 1 - roundTripFee : null;
}

function examples(rows, strategy) {
  const items = [];
  for (let i = 40; i + 1 + horizon < rows.length; i++) {
    const sample = rows.slice(i - 40, i + 1);
    const market = marketAnalyst(sample, strategy);
    const net = outcome(Number(rows[i + 1][1]), Number(rows[i + 1 + horizon][1]));
    if (net === null) throw Error('Invalid Demo open prices for forecasting');
    items.push({
      index: i, at: rows[i][6], input: features(sample, strategy, market), net, target: Number(net > 0),
      candidate: market.direction === 'UP' && market.rsi >= strategy.minRsi && market.rsi <= strategy.maxRsi && market.volume > 0
    });
  }
  return items;
}

export function wilson(wins, total) {
  if (!total) return 0;
  const z = 1.96;
  const p = wins / total;
  return (p + z ** 2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * total)) / total)) /
    (1 + z ** 2 / total);
}

export function trainForecast(rows, strategy, mistakes = []) {
  if (!Array.isArray(rows) || rows.length < 750) {
    return { status: 'insufficient', samples: rows?.length ?? 0, reason: 'At least 750 closed Demo candles are needed' };
  }
  const data = examples(rows, strategy);
  const trainEnd = Math.floor(data.length * 0.65);
  const calibrationEnd = Math.floor(data.length * 0.80);
  const train = data.slice(0, trainEnd - horizon - 1);
  const calibration = data.slice(trainEnd, calibrationEnd - horizon - 1);
  const holdout = data.slice(calibrationEnd);
  const layers = network(2019);
  const reviewedMistakes = new Set(mistakes.filter(item => item.net <= 0).map(item => item.at));
  for (let epoch = 0; epoch < 20; epoch++) {
    for (let j = 0; j < train.length; j++) {
      const example = train[(j + epoch * 47) % train.length];
      gradient(layers, example, 0.008 / (1 + epoch * 0.08), reviewedMistakes.has(example.at) ? 1.7 : 1);
    }
  }

  // Estimate reliability in fixed probability buckets using the untouched calibration period.
  const scores = calibration.map(sample => ({ sample, raw: forward(layers, sample.input).at(-1)[0] }));
  const buckets = Array.from({ length: 5 }, (_, index) => {
    const slice = scores.filter(entry => Math.min(4, Math.floor(entry.raw * 5)) === index);
    return { count: slice.length, wins: slice.reduce((sum, entry) => sum + entry.sample.target, 0) };
  });
  const artifact = { version: forecastVersion, layers, buckets, threshold };
  const independent = holdout.filter((_, index) => index % (horizon + 1) === 0);
  const qualified = independent.filter(sample => sample.candidate &&
    predict(artifact, sample.input)?.probability >= threshold);
  const wins = qualified.reduce((sum, sample) => sum + sample.target, 0);
  const meanReturn = qualified.length ? qualified.reduce((sum, sample) => sum + sample.net, 0) / qualified.length : null;
  const lowerBound = wilson(wins, qualified.length);
  const metrics = {
    train: train.length, calibration: calibration.length, holdout: independent.length, qualified: qualified.length,
    wins, precision: qualified.length ? wins / qualified.length : null, lowerBound, meanReturn, horizon,
    from: new Date(train[0].at).toISOString(), holdoutFrom: new Date(holdout[0].at).toISOString(),
    through: new Date(holdout.at(-1).at).toISOString(),
    reviewedMistakes: train.filter(sample => reviewedMistakes.has(sample.at)).length
  };
  const eligible = qualified.length >= minimumEvidence && lowerBound >= 0.60 && meanReturn > 0;
  return {
    status: eligible ? 'eligible' : 'insufficient-evidence', metrics,
    reason: eligible ? 'Passed the held-out probability, sample size, and net return checks' :
      'Held-out high-confidence observations did not meet all release criteria',
    artifact: eligible ? artifact : null
  };
}

export function predict(artifact, input) {
  if (artifact?.version !== forecastVersion || !Array.isArray(artifact.layers) || !Array.isArray(artifact.buckets) ||
      !Array.isArray(input) || input.length !== 8 || input.some(value => !Number.isFinite(value))) return null;
  const dimensions = [[10, 9], [6, 11], [1, 7]];
  if (artifact.layers.length !== dimensions.length || !artifact.layers.every((layer, depth) =>
    Array.isArray(layer) && layer.length === dimensions[depth][0] && layer.every(weights =>
      Array.isArray(weights) && weights.length === dimensions[depth][1] && weights.every(Number.isFinite)))) return null;
  const raw = forward(artifact.layers, input).at(-1)[0];
  const bucket = artifact.buckets[Math.min(4, Math.floor(raw * 5))];
  if (!bucket || !Number.isInteger(bucket.count) || !Number.isInteger(bucket.wins) ||
      bucket.count < 12 || bucket.wins < 0 || bucket.wins > bucket.count) return null;
  return { probability: (bucket.wins + 1) / (bucket.count + 2), calibrationCount: bucket.count };
}

export function forecastAssessment(active, symbol, rows, market, strategy, now = Date.now()) {
  if (!active || active.strategy !== strategy.id || Date.parse(active.expiresAt) <= now ||
      !Number.isFinite(Date.parse(active.expiresAt))) return { eligible: false, reason: 'No current administrator-approved model for this strategy' };
  const model = active.models?.[symbol];
  if (!model?.metrics || !Number.isInteger(model.metrics.qualified) || model.metrics.qualified < minimumEvidence ||
      !(model.metrics.lowerBound >= 0.60) || !(model.metrics.meanReturn > 0)) {
    return { eligible: false, reason: 'The approved model lacks sufficient held-out evidence for this pair' };
  }
  const estimate = predict(model.artifact, features(rows, strategy, market));
  return {
    eligible: Boolean(estimate && estimate.probability >= threshold), model: active.id, threshold,
    probability: estimate?.probability ?? null, calibrationCount: estimate?.calibrationCount ?? 0,
    reason: estimate ? estimate.probability >= threshold ? 'Calibrated score passed the entry threshold' :
      'Calibrated score is below the entry threshold' : 'The probability bucket lacks calibration samples'
  };
}

export function settleForecasts(pending, feed) {
  const resolved = [];
  const remaining = [];
  for (const row of pending ?? []) {
    const latest = feed[row.symbol]?.at(-1)?.[6];
    const close = row.at;
    const entry = close + 1;
    const exit = entry + horizon * 900000;
    if (latest == null || latest < exit + 899999) {
      if (Date.now() - close < 7 * 86400000) remaining.push(row);
      continue;
    }
    const candles = new Map(feed[row.symbol].slice(-600).map(candle => [candle[0], candle[1]]));
    const net = outcome(Number(candles.get(entry)), Number(candles.get(exit)));
    if (net !== null) resolved.push({ ...row, net, observedAt: new Date(exit + 899999).toISOString() });
  }
  return { remaining, resolved };
}
