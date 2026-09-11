import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedSession, HOUR } from '../src/trading.js';
import { snapshotShape, needsRecovery, preferredSnapshot, refreshSnapshot } from '../src/snapshot.js';
import { createLiveMarket, createMarketHandler } from './live-market.js';

const now = Date.parse('2026-09-11T09:00:00Z');
function fixture(time = now) {
  return { schemaVersion: 4, generatedAt: new Date(time).toISOString(), factors: [], disclosures: { items: [] }, quality: {}, candidates: ['CN', 'US', 'CRYPTO'].map(market => {
    const q = { key: market, market, ok: true, quoteDate: expectedSession(market, time), expectation: {} };
    return { ...q, dependencies: [{ ...q }] };
  }) };
}
const staleCN = () => { const d = fixture(); d.candidates[0].quoteDate = '2026-09-10'; d.candidates[0].dependencies[0].quoteDate = '2026-09-10'; return d; };

test('fresh snapshot timestamp alone cannot conceal an old Chinese close', () => {
  assert(needsRecovery(staleCN(), now));
  assert(!needsRecovery(fixture(), now));
  assert(needsRecovery(fixture(now - 15 * HOUR), now));
  assert(!snapshotShape({ ...fixture(), candidates: [fixture().candidates[0]] }));
});
test('old scheduled snapshots cannot replace a recovered snapshot or newer valid dates', () => {
  const fixed = fixture(), old = staleCN();
  assert.equal(preferredSnapshot(old, fixed, now), fixed);
  assert.equal(preferredSnapshot(fixed, old, now), fixed);
  const laterButPartial = { ...old, generatedAt: new Date(now + 10_000).toISOString() };
  assert.equal(preferredSnapshot(fixed, laterButPartial, now), fixed);
  assert.throws(() => preferredSnapshot(fixed, fixture(now + HOUR), now), /异常/);
});
test('scheduler missing: serve usable static markets first then automatically recover', async () => {
  const calls = [], shown = [], statuses = [];
  const result = await refreshSnapshot({ now: () => now, fetchJson: async kind => { calls.push(kind); return kind === 'static' ? staleCN() : fixture(); }, onData: x => shown.push(x), onRecovery: x => statuses.push(x) });
  assert.deepEqual(calls, ['static', 'live']);
  assert.equal(shown.length, 2); assert(needsRecovery(shown[0], now));
  assert(!needsRecovery(result.data, now)); assert.equal(result.warning, '');
  assert.deepEqual(statuses, [true, false]);
});
test('no redundant collection when the retained live snapshot is still valid', async () => {
  const calls = [], current = fixture();
  const result = await refreshSnapshot({ current, now: () => now, fetchJson: async kind => { calls.push(kind); return staleCN(); } });
  assert.deepEqual(calls, ['static']); assert.equal(result.data, current);
});
test('partial API recovery never trades away another currently usable market', () => {
  const current = staleCN(), incoming = fixture();
  incoming.candidates[1].ok = false;
  assert.equal(preferredSnapshot(current, incoming, now), current);
});
test('API failure preserves good data and explicitly warns without renewing timestamps', async () => {
  const current = staleCN();
  const result = await refreshSnapshot({ current, now: () => now, fetchJson: async kind => { if (kind === 'live') throw new Error('503'); return current; } });
  assert.equal(result.data, current); assert(needsRecovery(result.data, now)); assert.match(result.warning, /503/);
});
test('static deployment outage can recover directly from API; partial recovery is not called healthy', async () => {
  const result = await refreshSnapshot({ now: () => now, fetchJson: async kind => { if (kind === 'static') throw new Error('404'); return staleCN(); } });
  assert.equal(result.data.candidates.length, 3); assert.match(result.warning, /仍有1个/);
});
test('concurrent API requests coalesce and short cache avoids repeated upstream work', async () => {
  let calls = 0;
  const get = createLiveMarket({ now: () => now, build: async options => { calls++; assert.equal(options.budgetMs, 45000); await new Promise(r => setTimeout(r, 5)); return fixture(); } });
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(calls, 1); assert.equal(a, b); assert.equal(a.delivery, 'on-demand');
  await get(); assert.equal(calls, 1);
});
test('cache is invalidated at the A-share close even inside the cache TTL', async () => {
  let clock = Date.parse('2026-09-11T07:44:30Z'), calls = 0;
  const get = createLiveMarket({ now: () => clock, build: async () => { calls++; return fixture(clock); } });
  assert.equal((await get()).candidates[0].quoteDate, '2026-09-10');
  clock += 60_000;
  assert.equal((await get()).candidates[0].quoteDate, '2026-09-11'); assert.equal(calls, 2);
});
test('failed collection releases coalescing lock and respects cooldown before retry', async () => {
  let clock = now, calls = 0;
  const get = createLiveMarket({ now: () => clock, build: () => { calls++; if (calls === 1) throw new Error('upstream'); return fixture(clock); } });
  await assert.rejects(get(), /upstream/);
  await assert.rejects(get(), /稍后/); assert.equal(calls, 1);
  clock += 61_000; assert.equal((await get()).delivery, 'on-demand');
});
test('zero usable markets fails instead of announcing healthy freshly stamped data', async () => {
  const get = createLiveMarket({ now: () => now, build: async () => fixture(now - 30 * HOUR) });
  await assert.rejects(get(), /有效日线/);
});
test('HTTP endpoint is read only; errors are not cached or leaked', async () => {
  const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(v) { this.body = v; return this; } });
  let calls = 0;
  const handler = createMarketHandler(async () => { calls++; throw new Error('private stack or token'); });
  const post = response(); await handler({ method: 'POST' }, post); assert.equal(post.code, 405); assert.equal(calls, 0);
  const failed = response(); await handler({ method: 'GET' }, failed); assert.equal(failed.code, 503); assert.equal(failed.headers['Retry-After'], '60'); assert(!JSON.stringify(failed.body).includes('private'));
  assert.equal(failed.headers['Vercel-CDN-Cache-Control'], 'no-store');
});
