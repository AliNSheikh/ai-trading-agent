import { SaxesParser } from 'saxes';

const publisher = 'CoinDesk';
const source = 'https://www.coindesk.com/arc/outboundfeeds/rss';
const limit = 450000;
const terms = /\b(bitcoin|btc|ethereum|eth|solana|sol|crypto|stablecoin|binance)\b/i;

export function parseNews(xml, now = Date.now()) {
  const items = [];
  const parser = new SaxesParser();
  let active = null;
  let field = null;
  const fields = ['title', 'link', 'pubDate'];
  parser.on('doctype', () => { throw Error('Feed DTD prohibited'); });
  parser.on('opentag', tag => {
    if (tag.name === 'item') active = {};
    if (active && fields.includes(tag.name)) field = tag.name;
  });
  const capture = text => {
    if (active && field) active[field] = (active[field] ?? '') + text;
  };
  parser.on('text', capture);
  parser.on('cdata', capture);
  parser.on('closetag', tag => {
    if (field === tag.name) field = null;
    if (tag.name === 'item' && active) {
      items.push(active);
      active = null;
    }
  });
  parser.write(xml).close();

  const seen = new Set();
  const relevant = [];
  for (const item of items) {
    const title = item.title?.trim().slice(0, 250);
    const date = Date.parse(item.pubDate);
    if (!title || !terms.test(title) || !Number.isFinite(date) || date > now || date < now - 72 * 3600000) continue;
    let url;
    try { url = new URL(item.link?.trim()); } catch { continue; }
    if (url.origin !== 'https://www.coindesk.com' || url.username || url.password || !url.pathname.startsWith('/')) continue;
    url.search = '';
    url.hash = '';
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    relevant.push({ publisher, title, url: url.href, publishedAt: new Date(date).toISOString() });
  }
  return relevant.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 8);
}

export async function verifiedNews() {
  const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(7000) });
  if (!response.ok || !response.body) throw Error('News publisher HTTP ' + response.status);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw Error('News feed size exceeded');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return parseNews(Buffer.concat(chunks).toString('utf8'));
}
