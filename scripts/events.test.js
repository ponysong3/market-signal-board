import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_SOURCES, EVENT_TTL, FEED_TTL, classifyEvent, eventUrl, feedFresh, currentEvents, affectedEvents, eventRisk, applyEventRisk, stressLoss, eventTiming } from '../src/events.js';
import { parseEventSource, collectEvents } from './fetch-events.js';
import { createLiveEvents, createEventsHandler } from './live-events.js';
import { decisionView } from '../src/decision.js';

const now = Date.parse('2026-09-11T10:00:00Z');
const iso = n => new Date(n).toISOString();
const event = { sourceId: 'un', title: '霍尔木兹海峡停火谈判', url: 'https://news.un.org/zh/story/2026/09/1', publishedAt: iso(now - 3_600_000), precision: 'time', channels: ['energy', 'geopolitical'] };
const feed = (items = []) => ({ schemaVersion: 1, checkedAt: iso(now), items, sources: EVENT_SOURCES.map(s => ({ id: s.id, ok: true, invalid: 0, scanned: 10 })) });
const q = { key: 'csi300', market: 'CN', type: '宽基ETF', ok: true, quoteDate: '2026-09-11', changePct: 1, status: 'ready', plan: { maxPositionPct: 20 }, dependencies: [{ market: 'CN', ok: true, quoteDate: '2026-09-11' }] };
const snapshot = { generatedAt: iso(now), candidates: [q], factors: [] };
const ctx = events => ({ events, snapshot });
const source = id => EVENT_SOURCES.find(s => s.id === id);
const rss = (title = '霍尔木兹海峡新闻', date = 'Fri, 11 Sep 2026 08:00:00 GMT', link = 'https://news.un.org/zh/story/1') => `<rss><channel><item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${date}</pubDate></item></channel></rss>`;

test('headline matching never determines polarity, confirmation or surprise', () => {
  for (const title of ['伊朗否认发生袭击', '台海停火可能缓和风险', '伊朗冲突升级']) assert.deepEqual(classifyEvent(title, 'un'), ['geopolitical']);
  assert.deepEqual(classifyEvent('伊朗战争周年回顾', 'un'), []);
  assert.deepEqual(classifyEvent('贸易展览成功举行', 'mofcom'), []);
  const r = eventRisk(q, ctx(feed([event])), now);
  assert.equal(r.key, 'review'); assert.equal(r.multiplier, 0.5);
  assert(!('probability' in r)); assert(!('direction' in r));
});

test('old publications cannot renew their lifetime on fetch; stale and future checks fail closed', () => {
  assert.equal(currentEvents(feed([{ ...event, publishedAt: iso(now - EVENT_TTL) }]), now).length, 0);
  assert.equal(currentEvents(feed([event]), now + FEED_TTL).length, 0);
  assert.equal(feedFresh({ ...feed(), checkedAt: iso(now + 1) }, now), false);
  assert.equal(feedFresh(feed([{ ...event, publishedAt: iso(now + 1) }]), now), false);
  assert.equal(eventRisk(q, ctx(feed()), now + FEED_TTL).key, 'unknown');
});

test('deduplication does not turn duplicated headlines into independent corroboration', () => {
  assert.equal(currentEvents(feed([event, event, { ...event, url: event.url + '2' }]), now).length, 1);
  assert.equal(affectedEvents({ key: 'btc' }, feed([{ ...event, channels: ['trade'] }]), now).length, 0);
  assert.equal(affectedEvents({ key: 'nvda' }, feed([{ ...event, channels: ['trade'] }]), now).length, 1);
});

test('only pinned official HTTPS origins are accepted; credentials and spoofed hosts rejected', () => {
  for (const u of ['javascript:alert(1)', 'http://news.un.org/a', 'https://news.un.org.evil.test/a', 'https://evil.test/a', 'https://a:b@news.un.org/a', 'https://news.un.org:8443/a']) assert.equal(eventUrl(u, 'un'), null);
  assert.equal(eventUrl('/a?tracking=x#frag', 'un'), 'https://news.un.org/a');
  assert.equal(eventUrl('/a', 'unknown'), null);
});

test('RSS parser strips markup, requires timezone and rejects changed/error pages', () => {
  const parsed = parseEventSource(source('un'), rss('<b>霍尔木兹海峡</b> &amp; 新闻'), now);
  assert.equal(parsed.items[0].title, '霍尔木兹海峡 & 新闻');
  assert.throws(() => parseEventSource(source('un'), '<html>Rate limited</html>', now));
  assert.throws(() => parseEventSource(source('un'), rss('伊朗', '2026-09-11'), now));
  assert.throws(() => parseEventSource(source('un'), rss('伊朗', 'Fri, 11 Sep 2026 18:00:00 GMT'), now));
  assert.throws(() => parseEventSource(source('un'), rss('伊朗', undefined, 'https://evil.test/a'), now));
});

test('date-only publications preserve precision and conservative timezone boundaries', () => {
  const html = '<ul><li><a href="/xwfb/test/art/2026/a.html">出口管制说明</a>[2026-09-11]</li></ul>';
  const x = parseEventSource(source('mofcom'), html, now).items[0];
  assert.equal(x.precision, 'date'); assert.equal(x.publishedAt, '2026-09-10T16:00:00.000Z');
  assert.match(eventTiming(x, q), /仅有发布日期/);
  assert.throws(() => parseEventSource(source('mofcom'), html.replace('2026-09-11]', '2026-02-30]'), now));
  const ofac = '<div class="views-row"><a href="/recent-actions/20260911">Iran-related license</a>September 11, 2026 - Regulations</div>';
  assert.equal(parseEventSource(source('ofac'), ofac, now).items[0].publishedAt, '2026-09-11T00:00:00.000Z');
});

test('partial parse errors and source failures mean incomplete coverage, not no events', async () => {
  const result = await collectEvents({ now: () => now, request: async url => { if (url === source('un').url) return rss(); throw new Error('secret upstream details'); } });
  assert.equal(result.sources.filter(s => s.ok).length, 1);
  assert.equal(eventRisk(q, ctx(result), now).key, 'unknown');
  assert(!JSON.stringify(result).includes('secret'));
  const partial = feed(); partial.sources[0].invalid = 1;
  assert.equal(eventRisk(q, ctx(partial), now).key, 'unknown');
  assert.equal(eventRisk(q, { ...ctx(feed()), failed: true }, now).key, 'unknown');
});

test('a silent stale source is not fresh just because its endpoint still returns 200', async () => {
  const d = await collectEvents({ now: () => now, request: async () => rss('伊朗', 'Mon, 01 Jun 2026 08:00:00 GMT') });
  assert(d.sources.every(s => !s.ok));
});

test('all asset types get event risk caps; no-news never creates an entry', () => {
  for (const item of [q, { ...q, key: 'spy', market: 'US' }, { ...q, key: 'btc', type: '现货', market: 'CRYPTO' }]) {
    assert.equal(decisionView(item, now, ctx(undefined)).plan.maxPositionPct, 10);
    assert.equal(decisionView(item, now, ctx(feed([event]))).plan.maxPositionPct, 10);
    assert.equal(decisionView({ ...item, plan: null, status: 'avoid' }, now, ctx(feed())).plan, null);
  }
  const base = { plan: { maxPositionPct: 2.5 }, priority: true, reason: 'value', label: 'base' };
  const r = applyEventRisk(base, eventRisk(q, ctx(feed([event])), now));
  assert.equal(r.plan.maxPositionPct, 1.25); assert.equal(base.plan.maxPositionPct, 2.5); assert.equal(r.priority, false);
});

test('fresh price shock blocks additions, but stale prices cannot manufacture a shock', () => {
  assert.equal(eventRisk({ ...q, changePct: -5 }, ctx(feed()), now).key, 'shock');
  assert.equal(eventRisk({ ...q, changePct: 5 }, ctx(feed()), now).multiplier, 0);
  assert.equal(eventRisk({ ...q, changePct: 4.99 }, ctx(feed()), now).key, 'monitor');
  assert.equal(eventRisk({ ...q, changePct: -8, quoteDate: '2026-09-10' }, ctx(feed()), now).key, 'monitor');
  assert.equal(decisionView(q, now, { ...ctx(feed()), paused: true }).plan, null);
});

test('VIX stress requires current benchmark and current VIX, with no missing-number coercion', () => {
  const vix = { key: 'vix', value: 30, quoteDate: '2026-09-10', expiresAt: iso(now + 3_600_000) };
  const stressed = { ...snapshot, candidates: [{ ...q, changePct: -2 }], factors: [vix] };
  assert.equal(eventRisk(q, { events: feed(), snapshot: stressed }, now).key, 'stress');
  for (const bad of [{ ...vix, value: null }, { ...vix, quoteDate: '2026-09-09' }, { ...vix, expiresAt: iso(now) }]) {
    assert.equal(eventRisk(q, { events: feed(), snapshot: { ...stressed, factors: [bad] } }, now).key, 'monitor');
  }
});

test('stress arithmetic is a labeled bounded scenario, not an expected return', () => {
  assert.equal(stressLoss(20, 10), 2);
  assert.equal(stressLoss(0, 50), 0);
  for (const input of [-1, 101, NaN, Infinity, null, '20']) assert.equal(stressLoss(input, 10), null);
  assert.match(eventTiming({ ...event, publishedAt: iso(now) }, { ...q, quoteDate: '2026-09-10' }), /尚无完整日线/);
});

test('event API coalesces concurrent requests and retries partial collections sooner', async () => {
  let clock = now, calls = 0;
  const get = createLiveEvents({ now: () => clock, build: async () => { calls++; await new Promise(r => setTimeout(r, 5)); return feed(); } });
  await Promise.all([get(), get(), get()]); assert.equal(calls, 1);
  clock += 299_999; await get(); assert.equal(calls, 1);
  clock += 1; await get(); assert.equal(calls, 2);
  const partial = feed(); partial.sources[0].ok = false;
  const retry = createLiveEvents({ now: () => clock, build: () => { calls++; return partial; } });
  await retry(); clock += 60_000; await retry(); assert.equal(calls, 4);
});

test('synchronous event build failure releases the coalescing lock', async () => {
  let count = 0;
  const get = createLiveEvents({ build: () => { if (++count === 1) throw new Error('failure'); return feed(); } });
  await assert.rejects(get()); assert.deepEqual(await get(), feed());
});

test('event API enforces GET, prevents stale caching on failures and hides internal details', async () => {
  const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(d) { this.data = d; return this; } });
  const handler = createEventsHandler(async () => { throw new Error('private credentials'); });
  const res = response(); await handler({ method: 'GET' }, res);
  assert.equal(res.code, 503); assert.equal(res.headers['Vercel-CDN-Cache-Control'], 'no-store'); assert(!JSON.stringify(res).includes('private credentials'));
  const post = response(); await handler({ method: 'POST' }, post); assert.equal(post.code, 405);
  const good = response(); await createEventsHandler(async () => feed())({ method: 'GET' }, good); assert.equal(good.code, 200);
});
