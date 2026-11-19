import { checkModel } from './ai.js';
import { account, checkDemoOrder, demo } from './demo.js';
import { verifiedNews } from './news.js';
import { append, privateRepository, readData, scoped } from './store.js';

async function check(name, call) {
  try {
    const result = await call();
    return [name, { status: 'connected', ...result }];
  } catch (error) {
    const message = error?.message ?? '';
    const safe = /^(Binance Demo|GitHub|OpenAI|Demo |News )[- a-z0-9:()]+$/i.test(message);
    return [name, { status: 'unavailable', reason: safe ? message : 'Integration request failed' }];
  }
}

export async function integrationHealth({ verificationId } = {}) {
  const calls = [
    check('demoMarket', async () => { await demo('/api/v3/ping'); }),
    check('demoAccount', async () => { await account(); }),
    check('openAI', async () => ({ model: await checkModel() })),
    check('news', async () => ({ relevantHeadlines: (await verifiedNews()).length })),
    check('gitHub', async () => {
      await privateRepository();
      const [settings, journal] = await Promise.all([
        readData('config/defaults.json'), readData('journal/events.json')
      ]);
      if (!settings || !Array.isArray(journal?.events) || !Array.isArray(journal?.trades)) throw Error('GitHub legacy data unavailable');
    })
  ];
  if (verificationId) calls.push(
    check('demoOrderValidation', async () => { await checkDemoOrder(); }),
    check('gitHubWrite', async () => {
      await privateRepository();
      const path = scoped('verification/' + verificationId + '.json');
      const receipt = { check: 'configuration smoke test', commit: verificationId };
      await append(path, receipt);
      if ((await readData(path)).commit !== verificationId) throw Error('GitHub verification receipt mismatch');
    })
  );
  return Object.fromEntries(await Promise.all(calls));
}
