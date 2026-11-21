import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { integrationHealth } from '../lib/integrations.js';
import { rules } from '../lib/demo.js';

const env = process.env.VERCEL_ENV;
const sha = process.env.VERCEL_GIT_COMMIT_SHA;
const id = /^[a-f0-9]{40}$/.test(sha ?? '') ? sha : process.env.VERCEL_DEPLOYMENT_ID;
const direct = process.argv.includes('--check');
if (env === 'preview' || env === 'production' || direct) {
  const health = await integrationHealth({
    includeExchange: direct,
    verificationId: /^[-a-zA-Z0-9_]{8,90}$/.test(id ?? '') ? id : undefined
  });
  const admin = /^[a-f0-9]{32}:[0-9a-f]{64}$/.test(process.env.ADMIN_PASSWORD_HASH ?? '');
  const cron = (process.env.CRON_SECRET?.length ?? 0) >= 16;
  console.log('DEMO INTEGRATION VERIFICATION', JSON.stringify({ environment: env ?? 'development', admin, cron, health }));
  if ((env === 'production' || direct) &&
      (!admin || (env === 'production' && !cron) || !id || !health.gitHubWrite ||
        Object.values(health).some(item => item.status !== 'connected'))) {
    process.exitCode = 1;
  }
}
// Read-only public Demo exchange-filter verification. Never places an order.
if(env==='preview'||env==='production'){
  const sample=['BTCUSDT','ETHUSDT','SOLUSDT','DOGEUSDT','XRPUSDT'];
  const checks=await Promise.all(sample.map(async symbol=>{
    try{const item=await rules(symbol);return {symbol,status:'checked',minimum:item.minimum,
      tickSize:item.tickSize,opocoAllowed:item.opocoAllowed};}
    catch(error){return {symbol,status:'unavailable',reason: String(error?.message??'Demo market unavailable').slice(0,95)};}
  }));
  console.log('DEMO BRACKET MARKET CHECK',JSON.stringify(checks));
}
await mkdir('public/assets', { recursive: true });
await Promise.all([
  copyFile('web/office3d.js', 'public/assets/office3d.js'),
  copyFile('node_modules/three/build/three.module.js', 'public/assets/three.module.js'),
  copyFile('node_modules/three/build/three.core.js', 'public/assets/three.core.js'),
  copyFile('node_modules/three/LICENSE', 'public/assets/three-license.txt')
]);
await writeFile('public/robots.txt', 'User-agent: *\nDisallow: /\n');
