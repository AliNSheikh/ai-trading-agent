import { rules, bookTicker } from '../lib/demo.js';
import { securityHeaders } from '../lib/security.js';
// Strictly read-only diagnostic on protected preview deployments. No signed requests.
export default async function handler(req,res){
 securityHeaders(res);
 res.setHeader('Cache-Control','private, no-store');
 if(process.env.VERCEL_ENV!=='preview')return res.status(404).end();
 if(req.method!=='GET')return res.status(405).end();
 const symbols=['BTCUSDT','ETHUSDT','SOLUSDT','DOGEUSDT','XRPUSDT'];
 const rows=await Promise.all(symbols.map(async symbol=>{
   try{
     const [filter,ticker]=await Promise.all([rules(symbol),bookTicker(symbol)]);
     return {symbol,status:'connected',minimum:filter.minimum,
       opocoAllowed:filter.opocoAllowed,tickSize:filter.tickSize,
       spreadPercent:Number(((Number(ticker.askPrice)-Number(ticker.bidPrice))/Number(ticker.askPrice)*100).toFixed(3))};
   }catch(error){
     return {symbol,status:'unavailable',
       reason:String(error?.message??'Demo unavailable').slice(0,95)};
   }
 }));
 res.status(200).json({mode:'preview-readonly',region:process.env.VERCEL_REGION??'unknown',
    connected:rows.filter(x=>x.status==='connected').length,symbols:rows});
}
