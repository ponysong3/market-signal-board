import { load } from 'cheerio';
import { EVENT_SOURCES, EVENT_TTL, classifyEvent, eventUrl } from '../src/events.js';

const plain = text => load(`<body>${text}</body>`)('body').text().replace(/\s+/g, ' ').trim();

export function parseEventSource(source, text, now = Date.now()) {
  const $ = load(text, source.format === 'rss' ? { xml: true } : undefined);
  const rows = [];
  if (source.format === 'rss') {
    if (!$('rss > channel').length || !$('item').length) throw new Error('Feed structure changed');
    $('item').each((_, el) => {
      const e = $(el);
      rows.push({ title: plain(e.find('title').text()), url: e.find('guid').text().trim() || e.find('link').text().trim(), publishedAt: e.find('pubDate').text().trim(), precision: 'time' });
    });
  } else if (source.format === 'mofcom') {
    $('li').each((_, el) => {
      const a = $(el).find('a').first();
      if (!/\/xwfb\/.*\/art\//.test(a.attr('href') || '')) return;
      const date = $(el).text().match(/\[(\d{4}-\d{2}-\d{2})\]/)?.[1];
      const validDate = date && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
      rows.push({ title: a.text().trim(), url: a.attr('href'), publishedAt: validDate ? `${date}T00:00:00+08:00` : '', precision: 'date' });
    });
  } else {
    $('.views-row').each((_, el) => {
      const a = $(el).find('a').filter((i, link) => /^\/recent-actions\/\d{8}(?:-\d+)?$/.test($(link).attr('href') || '')).first();
      if (!a.length) return;
      const date = $(el).text().match(/(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/)?.[0];
      rows.push({ title: a.text().trim(), url: a.attr('href'), publishedAt: date ? `${date} 00:00:00 GMT` : '', precision: 'date' });
    });
  }
  if (!rows.length) throw new Error('No dated rows found');
  let invalid = 0;
  const seen = new Set();
  const valid = rows.flatMap(row => {
    const timestamp = Date.parse(row.publishedAt);
    const url = eventUrl(row.url, source.id);
    const zoned = /(?:GMT|UTC|Z|[+-]\d{2}:?\d{2})$/i.test(row.publishedAt);
    if (!row.title || row.title.length > 500 || !url || !zoned || !Number.isFinite(timestamp) || timestamp > now) { invalid++; return []; }
    if (seen.has(url)) return [];
    seen.add(url);
    return [{ ...row, url, sourceId: source.id, publishedAt: new Date(timestamp).toISOString(), channels: classifyEvent(row.title, source.id) }];
  });
  if (!valid.length) throw new Error('No valid dated rows found');
  return { items: valid.filter(e => now - Date.parse(e.publishedAt) < EVENT_TTL && e.channels.length),
    invalid, latestPublishedAt: valid.map(e => e.publishedAt).sort().at(-1), scanned: valid.length };
}

async function requestText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error', headers: { 'User-Agent': 'MarketSignalBoard/1.0 PublicFeedReader', Accept: 'application/rss+xml, application/xml, text/xml, text/html' } });
  if (!response.ok) throw new Error('Upstream unavailable');
  if (!/xml|html/.test(response.headers.get('content-type') || '')) throw new Error('Unexpected content type');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error('Feed size limit');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function collectEvents({ request = requestText, now = Date.now } = {}) {
  const collected = await Promise.all(EVENT_SOURCES.map(async source => {
    try {
      const parsed = parseEventSource(source, await request(source.url), now());
      const silenceDays = { un: 7, mofcom: 14, fed: 90, ofac: 14 }[source.id];
      if (now() - Date.parse(parsed.latestPublishedAt) > silenceDays * 24 * 3_600_000) throw new Error('Source publication dates too old');
      return { ...parsed, id: source.id, ok: true };
    } catch {
      return { id: source.id, ok: false, invalid: 0, scanned: 0, latestPublishedAt: null, items: [], error: '来源不可用或结构变化，未视为没有事件' };
    }
  }));
  return { schemaVersion: 1, checkedAt: new Date(now()).toISOString(),
    sources: collected.map(({ items, ...status }) => status),
    items: collected.flatMap(s => s.items).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 120) };
}
