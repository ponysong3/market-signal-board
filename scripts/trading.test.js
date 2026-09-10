import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyzeBars, buildCandidate, expectedSession, quoteFresh, snapshotFresh, signalActive, signalStatus, recentDisclosure, positionSize, DAY, HOUR } from '../src/trading.js';
import { parseSeriesCsv } from './update-market-data.js';

const now = Date.parse('2026-09-09T06:00:00Z');
const q = { key: 'demo', market: 'US', type: '股票', tick: 0.01, decimals: 2, ok: true, quoteDate: '2026-09-08', price: 120, high20: 119.9, ma20: 116, ma60: 108, atr: 2, return20d: 12, volumeRatio: 1.5 };
const bench = { ...q, key: 'spy', return20d: 5 };

test('timezone sessions respect US DST, preclose and weekends', () => {
  assert.equal(expectedSession('CN', now), '2026-09-08');
  assert.equal(expectedSession('CN', Date.parse('2026-09-09T08:00:00Z')), '2026-09-09');
  assert.equal(expectedSession('US', Date.parse('2026-09-07T12:00:00Z')), '2026-09-04');
  assert.equal(expectedSession('US', Date.parse('2026-09-09T20:30:00Z')), '2026-09-08');
  assert.equal(expectedSession('US', Date.parse('2026-12-09T21:50:00Z')), '2026-12-09');
});
test('old snapshots, future snapshots and stale dependencies fail closed in the browser', () => {
  assert(snapshotFresh(new Date(now).toISOString(), now));
  assert(!snapshotFresh(new Date(now).toISOString(), now + 15 * HOUR));
  assert(!snapshotFresh(new Date(now + HOUR).toISOString(), now));
  assert(!quoteFresh({ ...q, quoteDate: '2026-09-09' }, now));
  assert(!quoteFresh({ ...q, quoteDate: '2026-09-04' }, now));
  const item = buildCandidate(q, bench, now);
  assert(signalActive(item, new Date(now).toISOString(), now));
  assert(!signalActive({ ...item, dependencies: [{ ...bench, quoteDate: '2026-09-01' }] }, new Date(now).toISOString(), now));
  assert(!signalActive(item, new Date(now).toISOString(), now + 15 * HOUR));
});

test('A-share pre-buffer snapshot waits for the new close after 15:45 and recovers on collection', () => {
  const before = Date.parse('2026-09-10T07:27:00Z');
  const after = Date.parse('2026-09-10T07:50:00Z');
  const rows = Array.from({ length: 130 }, (_, i) => {
    const date = new Date(Date.parse('2026-09-10') - (129 - i) * DAY);
    return { date: date.toISOString().slice(0, 10), day: date.getUTCDay(), open: 100 + i, high: 103 + i, low: 99 + i, close: 102 + i, volume: 100 };
  }).filter(r => ![0, 6].includes(r.day));
  const instrument = { ...q, market: 'CN' };
  const earlyQuote = analyzeBars(instrument, rows, before);
  const early = buildCandidate(earlyQuote, earlyQuote, before);
  const generated = new Date(before).toISOString();
  assert.equal(early.quoteDate, '2026-09-09');
  assert(signalActive(early, generated, before));
  assert(snapshotFresh(generated, after), 'the snapshot itself has not expired');
  assert(!signalActive(early, generated, after), 'do not extend old daily prices through a new close');
  assert.equal(signalStatus(early, generated, after).label, '等待收盘更新');
  assert.match(signalStatus(early, generated, after).reason, /2026-09-10.*2026-09-09/);
  const latestQuote = analyzeBars(instrument, rows, after);
  const latest = buildCandidate(latestQuote, latestQuote, after);
  assert.equal(latest.quoteDate, '2026-09-10');
  assert(signalActive(latest, new Date(after).toISOString(), after));
  const staleBenchmark = { ...latest, dependencies: early.dependencies };
  assert.equal(signalStatus(staleBenchmark, generated, after).label, '等待基准更新');
});

test('availability separates failed collection, expired snapshot and abnormal dates', () => {
  const at = Date.parse('2026-09-10T09:00:00Z');
  const stamp = new Date(at).toISOString();
  assert.equal(signalStatus({ ...q, ok: false, error: 'HTTP failure' }, stamp, at).reason, 'HTTP failure');
  assert.equal(signalStatus(q, '2020-01-01', at).label, '快照已失效');
  assert.equal(signalStatus({ ...q, market: 'CN', quoteDate: '2026-09-11' }, stamp, at).label, '行情日期异常');
  assert(!signalActive({ ...q, quoteDate: '2026-09-09', dependencies: [] }, stamp, at));
});

test('scheduled A-share supplement runs after the close publication buffer', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/update-market-data.yml', import.meta.url), 'utf8');
  assert(workflow.includes('cron: "50 7 * * 1-5"'));
  assert(workflow.includes('cron: "0 23,11 * * *"'), 'retain the existing morning/evening schedule');
  assert.equal(expectedSession('CN', Date.parse('2026-09-10T07:50:00Z')), '2026-09-10');
});
test('crypto is continuous and old closes expire even over weekends', () => {
  const c = { ...q, market: 'CRYPTO', quoteDate: '2026-09-07' };
  assert(quoteFresh(c, now));
  assert(!quoteFresh(c, now + 7 * HOUR));
  assert(!quoteFresh({ ...c, quoteDate: '2026-09-09' }, now));
});
test('closed bars exclude partial candles and compare volume against prior bars', () => {
  const rows = Array.from({ length: 80 }, (_, i) => ({ date: new Date(Date.parse('2026-09-09') - (79 - i) * DAY).toISOString().slice(0, 10), open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 100 }));
  rows.at(-1).high = 10000; rows.at(-1).volume = 100000;
  rows.at(-2).volume = 200;
  const result = analyzeBars({ ...q, market: 'CRYPTO' }, rows, now);
  assert.equal(result.quoteDate, '2026-09-08');
  assert.equal(result.volumeRatio, 2);
  assert(result.high20 < 10000);
  assert.equal(result.return5d, (179 / 174 - 1) * 100);
  assert.throws(() => analyzeBars(q, rows.slice(-10), now), /65/);
  assert.throws(() => analyzeBars(q, [...rows, rows[0]], now), /重复/);
  assert.throws(() => analyzeBars(q, rows.map((r, i) => i === 1 ? { ...r, low: 0 } : r), now), /异常/);
});
test('a valid setup is conditional; missing volume, weak trend, stale data and chasing are gated', () => {
  const c = buildCandidate(q, bench, now);
  assert.equal(c.status, 'ready');
  assert(c.plan.stop < c.plan.entry && c.plan.entryMax < c.plan.target && c.plan.rr >= 1.5);
  assert.equal(buildCandidate({ ...q, volumeRatio: null }, bench, now).status, 'watch');
  assert.equal(buildCandidate({ ...q, price: 135 }, bench, now).status, 'extended');
  assert.equal(buildCandidate(q, { ...bench, ma60: 150 }, now).status, 'avoid');
  assert.equal(buildCandidate(q, { ...bench, quoteDate: '2026-09-01' }, now).plan, null);
  assert.equal(buildCandidate({ ...q, ok: false }, bench, now).plan, null);
});
test('position size obeys risk budget, concentration limit and lot size', () => {
  const p = buildCandidate(q, bench, now).plan;
  for (const capital of [1000, 10000, 100000, 1000000]) {
    const size = positionSize(p, capital, 0.5, 100);
    assert(size.risk <= capital * 0.005 + 0.01);
    assert(size.value <= capital * p.maxPositionPct / 100 + 0.01);
    assert.equal(size.units % 100, 0);
  }
  assert.equal(positionSize(p, 1, 0.5, 100).units, 0);
  assert.equal(positionSize(p, -1, 0.5, 100), null);
  assert.equal(positionSize(p, 1000, 5, 100), null);
});
test('disclosures expire after seven days and future dates are excluded', () => {
  assert(recentDisclosure({ date: '2026-09-08' }, now));
  assert(!recentDisclosure({ date: '2026-01-01' }, now));
  assert(!recentDisclosure({ date: '2026-09-10' }, now));
});
test('FRED missing observations never become a zero rate', () => {
  assert.deepEqual(parseSeriesCsv('DATE,DGS10\n2026-09-01,4.2\n2026-09-02,\n2026-09-03,.\n2026-09-04,0\n'), [{ date: '2026-09-01', value: 4.2 }, { date: '2026-09-04', value: 0 }]);
});
