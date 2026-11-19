import {createHmac} from 'node:crypto';
export const BASE='https://demo-api.binance.com';
const allowed=new Set(['/api/v3/time','/api/v3/ping','/api/v3/klines','/api/v3/account','/api/v3/allOrders','/api/v3/myTrades']);
export async function demo(path,params={},signed=false){
 if(!allowed.has(path))throw Error('Endpoint prohibited');
 const q=new URLSearchParams(params);const headers={};
 if(signed){const key=process.env.BINANCE_DEMO_API_KEY,secret=process.env.BINANCE_DEMO_API_SECRET;if(!key||!secret)throw Error('Demo credentials not configured');q.set('timestamp',String(Date.now()));q.set('recvWindow','5000');q.set('signature',createHmac('sha256',secret).update(q.toString()).digest('hex'));headers['X-MBX-APIKEY']=key;}
 const r=await fetch(BASE+path+'?'+q,{headers,redirect:'error',signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error('Demo API HTTP '+r.status);return r.json();
}
