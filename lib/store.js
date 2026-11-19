const BASE='https://api.github.com/repos/AliNSheikh/ai-trading-data/contents/';
export async function readData(path){
 const token=process.env.GITHUB_DATA_TOKEN;
 if(!token)throw Error('Data token not configured');
 if(!['config/defaults.json','journal/events.json'].includes(path))throw Error('Invalid data path');
 const r=await fetch(BASE+path,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error('Data store unavailable');
 const j=await r.json();return JSON.parse(Buffer.from(j.content,'base64').toString('utf8'));
}
