import { mkdir, writeFile } from 'node:fs/promises';
import { integrationHealth } from '../lib/integrations.js';

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
await mkdir('public', { recursive: true });
await writeFile('public/robots.txt', 'User-agent: *\nDisallow: /\n');
