// Shadow (paper) bracket trades. Every cost-qualified signal is simulated forward on real closed candles so
// the learner gets hundreds of unbiased observations per day without placing orders. Pessimistic rules:
// stop wins when stop and target touch inside one bar; a gap through the stop fills at the open.
export const costDefaults = Object.freeze({ fee: 0.001, slip: 0.0005, spread: 0 });
export const roundTrip = c => 2 * (c.fee + c.slip) + (c.spread ?? 0);
let counter = 0;
export function newShadow(signal, signalAt, extra = {}) {
  return { id: signalAt + ':' + signal.symbol + ':' + signal.strategy + ':' + signal.variant + ':' + (counter++ % 1000),
    symbol: signal.symbol, strategy: signal.strategy, variant: signal.variant, family: signal.family, regime: signal.regime,
    market: signal.market, signalAt, stopPct: signal.stopPct, targetPct: signal.targetPct, maxBars: signal.maxBars,
    roundTrip: signal.roundTrip, features: signal.features ?? null, ...extra };
}
// Walk bars strictly after the signal bar. Returns null while the trade is still unresolved.
export function stepShadow(sh, bars) {
  const start = bars.findIndex(b => b.t > sh.signalAt);
  if (start < 0) return null;
  const entry = bars[start].o, stop = entry * (1 - sh.stopPct), target = entry * (1 + sh.targetPct);
  let mae = 0, mfe = 0;
  for (let k = start; k < bars.length; k++) {
    const b = bars[k], held = k - start + 1;
    mae = Math.min(mae, b.l / entry - 1); mfe = Math.max(mfe, b.h / entry - 1);
    let exit = null, price = null;
    if (b.o <= stop) { exit = 'stop'; price = b.o; }
    else if (b.l <= stop) { exit = 'stop'; price = stop; }
    else if (b.h >= target) { exit = 'target'; price = target; }
    else if (held >= sh.maxBars) { exit = 'time'; price = b.c; }
    if (exit) {
      const net = price / entry - 1 - sh.roundTrip;
      return { exit, bars: held, entry, exitPrice: price, net, r: net / sh.stopPct, mae: mae / sh.stopPct, mfe: mfe / sh.stopPct, exitAt: b.ct };
    }
  }
  return null;
}
export function resolveShadows(open, barsBySymbol) {
  const remaining = [], resolved = [];
  for (const sh of open) {
    const bars = barsBySymbol[sh.symbol];
    const result = bars ? stepShadow(sh, bars) : null;
    if (result) resolved.push({ ...sh, ...result });
    else if (bars?.length && bars.at(-1).ct - sh.signalAt < (sh.maxBars + 8) * 900000) remaining.push(sh);
    // Unresolvable stale shadows (symbol dropped from the feed) are discarded instead of polluting statistics.
  }
  return { remaining, resolved };
}
