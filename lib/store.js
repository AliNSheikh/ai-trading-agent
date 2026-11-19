import { migrateSettings, defaultStrategy, validateSettings } from './settings.js';

const repository = 'https://api.github.com/repos/AliNSheikh/ai-trading-data';
const permitted = /^(config\/defaults\.json|journal\/events\.json|v1\/(production|preview|development)\/(state\.json|auth\.json|(?:runs|audit|verification)\/[\w-]{1,90}\.json))$/;
export const scope = () => ['production', 'preview'].includes(process.env.VERCEL_ENV) ? process.env.VERCEL_ENV : 'development';
export const scoped = path => 'v1/' + scope() + '/' + path;

export class Conflict extends Error {}
export class StoreError extends Error {}

async function request(endpoint, options = {}) {
  if (!process.env.GITHUB_DATA_TOKEN) throw new StoreError('GitHub data token unavailable');
  return fetch(repository + endpoint, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(7000),
    headers: {
      Authorization: 'Bearer ' + process.env.GITHUB_DATA_TOKEN,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
}

function contents(path) {
  if (!permitted.test(path)) throw new StoreError('Invalid GitHub data path');
  return '/contents/' + path;
}

export async function privateRepository() {
  const response = await request('');
  if (!response.ok) throw new StoreError('GitHub repository HTTP ' + response.status);
  const repo = await response.json();
  if (repo.private !== true || repo.default_branch !== 'main') throw new StoreError('GitHub data repository must be private on main');
}

export async function readFile(path, optional = false) {
  const response = await request(contents(path) + '?ref=main');
  if (response.status === 404 && optional) return { data: null, sha: undefined };
  if (!response.ok) throw new StoreError('GitHub read HTTP ' + response.status);
  const file = await response.json();
  if (file.type !== 'file' || file.encoding !== 'base64' || !/^[a-f0-9]{40}$/.test(file.sha)) {
    throw new StoreError('Unexpected GitHub file');
  }
  try {
    return { data: JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')), sha: file.sha };
  } catch {
    throw new StoreError('Invalid GitHub JSON');
  }
}

export async function readData(path) {
  return (await readFile(path)).data;
}

async function writeFile(path, data, sha) {
  const content = JSON.stringify(data);
  if (Buffer.byteLength(content) > 700000) throw new StoreError('GitHub journal capacity reached');
  const response = await request(contents(path), {
    method: 'PUT',
    body: JSON.stringify({
      message: 'Demo platform: ' + path, branch: 'main', sha,
      content: Buffer.from(content).toString('base64')
    })
  });
  if (response.status === 409 || (response.status === 422 && !sha)) throw new Conflict('Concurrent GitHub write');
  if (!response.ok) throw new StoreError('GitHub write HTTP ' + response.status);
}

export async function update(path, initial, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const snapshot = await readFile(path, true);
    const data = snapshot.sha ? snapshot.data : await initial();
    const result = await change(data);
    if (result?.unchanged) return result.value;
    try {
      await writeFile(path, data, snapshot.sha);
      return result;
    } catch (error) {
      if (!(error instanceof Conflict) || attempt === 4) throw error;
    }
  }
}

export async function append(path, data) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await writeFile(path, data);
      return;
    } catch (error) {
      if (!(error instanceof Conflict)) throw error;
      const existing = await readFile(path, true);
      if (existing.sha) {
        if (JSON.stringify(existing.data) !== JSON.stringify(data)) throw error;
        return;
      }
      if (attempt === 4) throw error;
      // A concurrent commit to a different path can still move the shared branch reference.
      await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}

async function initialState() {
  const [legacySettings, legacyJournal] = await Promise.all([
    readData('config/defaults.json'), readData('journal/events.json'), privateRepository()
  ]);
  if (!Array.isArray(legacyJournal.trades) || !Array.isArray(legacyJournal.events)) {
    throw new StoreError('Legacy journal requires administrator review');
  }
  return {
    schema: 1, settings: migrateSettings(legacySettings), strategy: defaultStrategy,
    stopped: true, verification: null, lease: null, pending: null, positions: {},
    head: null, auditHead: null, lastScheduled: {}, latestReviewDay: null, latest: {},
    proposal: null, days: {}, months: {}, realized: 0, ai: {}, operations: {}
  };
}

function validateState(state) {
  if (state?.schema !== 1 || typeof state.stopped !== 'boolean' ||
      !state.positions || !state.strategy?.id || !Number.isFinite(state.realized) ||
      !state.days || !state.months || !state.lastScheduled || !state.operations || !state.ai ||
      !state.latest || !Object.hasOwn(state, 'pending') || !Object.hasOwn(state, 'lease')) {
    throw new StoreError('Invalid Demo state');
  }
  validateSettings(state.settings);
  return state;
}

export async function getState() {
  const file = await readFile(scoped('state.json'), true);
  return file.sha ? validateState(file.data) : initialState();
}

export function changeState(change) {
  return update(scoped('state.json'), initialState, state => change(validateState(state)));
}

export function appendRun(id, record) {
  return append(scoped('runs/' + id + '.json'), record);
}

export async function history(kind, head, limit = 8, environment = scope()) {
  const results = [];
  while (head && results.length < limit) {
    const item = await readData('v1/' + environment + '/' + kind + '/' + head + '.json');
    if (item.id !== head || results.some(result => result.id === item.id)) throw new StoreError('Invalid journal chain');
    results.push(item);
    head = item.previous;
  }
  return { items: results, next: head };
}
