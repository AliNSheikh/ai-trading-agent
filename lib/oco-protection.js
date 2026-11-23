import { protectivePlan } from './protective-plan.js';

// Exchange-native Spot OCO specification, prepared offline before any order.
// No network call or trading authority is provided by this module.
const decimal = (value, digits = 8) => Number(value.toFixed(digits)).toFixed(digits);
const floorStep = (value, step) => Math.floor(value/step+1e-9)*step;
const ceilStep = (value, step) => Math.ceil(value/step-1e-9)*step;

export function prepareDemoOco({symbol,entryPrice,quantity,volatilityPercent,riskUsd,tickSize,stepSize,minNotional,feeRate=0.002}) {
 if(!/^[A-Z0-9]{3,20}USDT$/.test(symbol)||![entryPrice,quantity,tickSize,stepSize,minNotional].every(
 x=>Number.isFinite(x)&&x>0))throw Error('Invalid Spot OCO filters');
 const qty=floorStep(quantity,stepSize);
 if(qty<=0)throw Error('Demo OCO quantity below lot size');
 const plan=protectivePlan({price:entryPrice,notional:qty*entryPrice,riskUsd,volatilityPercent,feeRate});
 if(plan.status!=='planned')return {status:'rejected',plan,reason:'Estimated risk exceeds allocation'};
 const stop=floorStep(plan.stopPrice,tickSize),target=ceilStep(plan.targetPrice,tickSize);
 if(!(stop>0&&stop<entryPrice&&target>entryPrice))throw Error('Invalid Spot protective prices');
 if(qty*stop<minNotional||qty*target<minNotional) return {status:'rejected',plan,reason:'OCO notional below exchange minimum'};
 // The STOP_LOSS stop price is a trigger, not a guarantee of execution price.
 return {status:'ready-for-demo-validation',plan,
   params:{symbol,side:'SELL',quantity:decimal(qty),aboveType:'LIMIT_MAKER',
   abovePrice:decimal(target),belowType:'STOP_LOSS',belowStopPrice:decimal(stop)},
   exchange:'binance-demo',submitted:false,verified:false};
}

export function verifyDemoOco({request,exchangeResponse}) {
 if(request?.status!=='ready-for-demo-validation'||request.submitted||request.verified)throw Error('Invalid OCO submission state');
 if(exchangeResponse?.contingencyType!=='OCO'||exchangeResponse?.listOrderStatus!=='EXECUTING'||
   exchangeResponse?.symbol!==request.params.symbol||
   !Array.isArray(exchangeResponse.orders)||exchangeResponse.orders.length!==2)
   return {verified:false,reason:'Binance Demo OCO placement confirmation incomplete'};
 return {verified:true,exchange:'binance-demo',status:'EXECUTING',quantity:request.params.quantity,
   stopPrice:request.params.belowStopPrice,orderListId:exchangeResponse.orderListId};
}
