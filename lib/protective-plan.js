// A calculation and validation layer; this module intentionally cannot submit orders.
// Exchange-native protection must be installed and reconciled before any future entry
// is allowed to assume reduced risk rather than full-principal exposure.
export function protectivePlan({price,notional,riskUsd,volatilityPercent,feeRate=0.002,minimumStopPercent=0.4,maximumStopPercent=4}) {
 const values=[price,notional,riskUsd,volatilityPercent,feeRate];
 if(!values.every(Number.isFinite)||price<=0||notional<=0||riskUsd<=0||volatilityPercent<0||feeRate<0||feeRate>=.05)
   throw Error('Invalid protective risk inputs');
 const stopPct=Math.max(minimumStopPercent,Math.min(maximumStopPercent,volatilityPercent*1.5));
 const expectedCostUsd=notional*(stopPct/100+feeRate*2);
 const allowed=expectedCostUsd<=riskUsd;
 const stopPrice=price*(1-stopPct/100),targetPrice=price*(1+stopPct/100*1.8);
 return {status:allowed?'planned':'risk-rejected',entryPrice:price,notional,riskUsd,
   stopPercent:stopPct,stopPrice,targetPrice,estimatedLossUsd:expectedCostUsd,
   riskRewardTarget:1.8,protectedOnExchange:false,
   warning:'Estimated stop loss is not guaranteed; gaps, fees, slippage, exchange outages and missing OCO orders can increase loss.'};
}
export function requiresExchangeProtection({plan,exchangeOrder}) {
 return Boolean(plan?.status==='planned' && exchangeOrder?.verified===true &&
  exchangeOrder?.exchange==='binance-demo' && exchangeOrder?.side==='SELL' &&
  Number(exchangeOrder.stopPrice)>0 && Number(exchangeOrder.stopPrice)<=plan.stopPrice &&
  exchangeOrder.status==='EXECUTING');
}
