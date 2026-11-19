import {protect} from '../lib/security.js';
import {demo} from '../lib/demo.js';
export default async function handler(req,res){
 if(!protect(req,res))return;
 if(req.method!=='GET')return res.status(405).end();
 try{const symbols=['BTCUSDT','ETHUSDT','SOLUSDT'];const rows=await Promise.all(symbols.map(async symbol=>({symbol,orders:(await demo('/api/v3/allOrders',{symbol,limit:50},true)).map(o=>({symbol:o.symbol,orderId:o.orderId,side:o.side,status:o.status,price:o.price,executedQty:o.executedQty,quoteQty:o.cummulativeQuoteQty,time:new Date(o.time).toISOString(),origin:'Demo account order; strategy not attributed'}))})));res.json({mode:'demo',orders:rows.flatMap(x=>x.orders).sort((a,b)=>b.time.localeCompare(a.time))});}catch{res.status(503).json({error:'Demo history unavailable'});}
}
