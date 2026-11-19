import { inUsd, periods } from './settings.js';

export const fractionForFees = 0.01;
const failure = reason => ({ accepted: false, reason });
const floor = (number, precision) => Math.floor(number * 10 ** precision) / 10 ** precision;

export function currentVerification(state, fingerprint, now = Date.now()) {
  return Boolean(fingerprint && state.verification?.fingerprint === fingerprint &&
    Number.isFinite(state.verification.expires) && state.verification.expires > now);
}

export function evaluateRisk({ state, decision, symbol, market, rules, wallet, verified, now = Date.now() }) {
  const { settings, positions } = state;
  const position = positions[symbol];
  const { day, month } = periods(now);
  const today = state.days[day] ?? { volume: 0, trades: 0, loss: 0 };
  const monthly = state.months[month] ?? { loss: 0 };
  const openCost = Object.values(positions).reduce((sum, item) => sum + item.cost, 0);
  const headroom = {
    allocation: settings.capital + Math.min(0, state.realized) - openCost,
    volume: inUsd(settings, 'dailyVolume') - today.volume,
    dailyLoss: inUsd(settings, 'dailyLoss') - today.loss - openCost,
    monthlyLoss: inUsd(settings, 'monthlyLoss') - monthly.loss - openCost,
    position: inUsd(settings, 'maxPosition'),
    perTrade: inUsd(settings, 'riskPerTrade')
  };
  const rejected = (reason, code = 'risk-limit') => ({ ...failure(reason), code, headroom });
  if (!settings.pairs.includes(symbol)) return rejected('Pair is disabled', 'pair-disabled');
  if (decision.side === 'HOLD') return rejected('No order proposed', 'hold');
  if (!['BUY', 'SELL'].includes(decision.side)) return rejected('Invalid order side', 'invalid-side');
  if (state.stopped || !verified) return rejected('Demo execution is stopped or awaiting verification', 'execution-disabled');
  if (state.pending) return rejected('An order requires reconciliation', 'pending');
  if (!Number.isFinite(market.price) || market.price <= 0 || !Number.isFinite(Date.parse(market.closedAt)) ||
      Date.parse(market.closedAt) > now || now - Date.parse(market.closedAt) > 960000) {
    return rejected('Latest closed Demo candle is stale');
  }
  if (!rules || wallet?.canTrade !== true) return rejected('Trading permissions or Demo market rules unavailable');
  const balance = asset => Number(wallet.balances.find(row => row.asset === asset)?.free ?? 0);
  if (decision.side === 'SELL') {
    if (!position || balance(rules.baseAsset) < position.quantity) return rejected('Tracked Demo position unavailable in the wallet');
    const amount = floor(Math.floor(position.quantity / rules.step + 1e-9) * rules.step + 1e-12, 8);
    if (amount < rules.minQty || amount > rules.maxQty || amount * market.price < rules.minimum) {
      return rejected('Tracked quantity falls below the Demo exit filters');
    }
    // Exit fills are accounted in volume. The entry limit does not prevent reducing an open exposure.
    return { accepted: true, amount: amount.toFixed(8), reason: 'Exit decreases the tracked Spot exposure', code: 'exit-approved', headroom };
  }
  if (position || Object.keys(positions).length >= settings.maxOpenPositions) return rejected('Open position limit reached');
  if (today.trades >= settings.maxTrades) return rejected('Daily new trade limit reached');
  if (Object.values(headroom).some(value => !Number.isFinite(value))) return rejected('Risk ledger unavailable');
  const feeRate = Number(wallet.commissionRates?.taker) + Number(wallet.commissionRates?.buyer);
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > fractionForFees) return rejected('Demo entry fee exceeds the reserved buffer or is unavailable');
  const amount = floor(Math.min(...Object.values(headroom), balance('USDT')) / (1 + fractionForFees), 2);
  if (!Number.isFinite(amount) || amount < rules.minimum) {
    return rejected('Allowed full-loss risk is below Binance Demo minimum order size');
  }
  return { accepted: true, amount: amount.toFixed(2), reason: 'Full principal and fee buffer fit the configured limits', code: 'entry-approved', headroom };
}
