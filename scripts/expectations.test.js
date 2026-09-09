import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForecasts, summarizeForecasts, priceHurdle, expectationView, expectationFresh } from '../src/expectations.js';
import { buildEquityValue } from '../src/valuation.js';
import { decisionView } from '../src/decision.js';
import { collectExpectations } from './fetch-expectations.js';

const now = Date.parse('2026-09-09T07:00:00Z');
const q = { key: 'cypc', market: 'CN', symbol: '600900', type: '股票', currency: 'CNY', price: 10, quoteDate: '2026-09-08', status: 'ready', plan: { maxPositionPct: 10 } };
const financial = { reportDate: '2026-06-30', publishedAt: '2026-08-20', annualDate: '2025-12-31', currency: 'CNY', referencePrice: 10, priceDate: q.quoteDate, ttmEPS: 2.2, annualEPS: 2, cashConversion: 1.2, debtRatio: 55 };
const valuation = buildEquityValue(q, financial, now);
const report = (org = 'A', eps = '2', date = '2026-09-01', id = 'AP20260901001') => ({ stockCode: '600900', orgCode: org, orgName: org, publishDate: `${date} 00:00:00.000`, infoCode: id, predictNextYearEps: eps });
const body = rows => ({ currentYear: 2026, TotalPage: 1, data: rows });
const parsed = rows => normalizeForecasts(body(rows), q, now);
const sample = (eps = '2', count = 3) => summarizeForecasts(parsed(Array.from({ length: count }, (_, i) => report(`org${i}`, eps, '2026-09-01', `AP20260901${i}`))), financial.publishedAt, now);

test('forecast parser rejects unknown year, future, old, wrong instrument, empty and invalid dates', () => {
  assert.throws(() => normalizeForecasts({ currentYear: 2025, data: [] }, q, now), /年度/);
  const rows = [report(), report('B', '', '2026-09-01', 'AP2'), report('C', '3', '2026-09-10', 'AP3'), report('D', '3', '2026-05-01', 'AP4'), report('E', '3', '2026-02-30', 'AP5'), { ...report('F'), stockCode: '601899' }, report('G', '3', '2025-12-31', 'AP6')];
  assert.equal(parsed(rows).length, 1);
  assert.equal(parsed(rows)[0].fiscalYear, 2027);
});

test('latest per broker; before-financial and stale forecasts do not inflate coverage', () => {
  const rows = parsed([report(), report('A', '1.8', '2026-08-01', 'AP2'), report('B', '3', '2026-08-19', 'AP3'), report('C', '5', '2026-07-01', 'AP4')]);
  const e = summarizeForecasts(rows, financial.publishedAt, now);
  assert.equal(e.count, 1); assert.equal(e.medianEPS, 2);
  assert.equal(e.pairs.length, 1); assert.equal(e.pairs[0].before, 1.8);
  assert.equal(expectationView({ ...q, valuation, expectation: e }, now).key, 'thin');
});

test('same-day conflicting forecasts and mixed currency or year fail closed', () => {
  assert.throws(() => summarizeForecasts(parsed([report(), report('A', '3', '2026-09-01', 'AP2')]), financial.publishedAt, now), /无有效/);
  const rows = parsed([report(), report('B', '3', '2026-09-02', 'AP2')]);
  assert.throws(() => summarizeForecasts([rows[0], { ...rows[1], fiscalYear: 2028 }], financial.publishedAt, now), /混杂/);
  assert.throws(() => summarizeForecasts([rows[0], { ...rows[1], currency: 'USD' }], financial.publishedAt, now), /混杂/);
});

test('model price hurdle uses the exact target-year horizon and inverse identity', () => {
  const h = priceHurdle(100, '2026-09-08', 2027, 20, 10);
  assert(h.years > 1 && h.years < 2);
  assert(Math.abs(h.requiredEPS * 20 / 1.1 ** h.years - 100) < 1e-10);
  assert.equal(priceHurdle(100, '2026-09-08', 2025, 20, 10), null);
  assert.equal(priceHurdle(100, '2026-09-08', 2031, 20, 10), null);
  assert.equal(priceHurdle(100, '2026-09-08', 2027, 0, 10), null);
});

test('refresh cannot make old research new; expiration removes comparisons and priority', () => {
  const e = sample();
  const expired = Date.parse(e.expiresAt);
  assert(!expectationFresh({ ...e, checkedAt: new Date(expired).toISOString() }, expired));
  const view = expectationView({ ...q, valuation, expectation: e }, expired);
  assert.equal(view.key, 'missing'); assert.equal(view.hurdle, undefined);
  assert(!expectationFresh({ ...e, checkedAt: '2026-10-01' }, now));
});

test('new brokers do not imply revisions; same-broker year and minimum interval matter', () => {
  assert.equal(sample().pairs.length, 0);
  const rows = parsed([report(), report('A', '1', '2026-08-29', 'AP2')]);
  assert.equal(summarizeForecasts(rows, financial.publishedAt, now).pairs.length, 0);
  const history = parsed([report(), report('A', '1', '2026-08-20', 'AP3')]);
  const e = summarizeForecasts(history, financial.publishedAt, now);
  assert.equal(e.pairs[0].changePct, 100);
});

test('negative and zero EPS are not treated as cheap forward multiples', () => {
  for (const value of ['-1', '0']) {
    const view = expectationView({ ...q, valuation, expectation: sample(value) }, now);
    assert.equal(view.key, 'demanding'); assert.equal(view.referencePE, null);
  }
});

test('a nonpositive revision baseline cannot be skipped to cherry-pick an older profit', () => {
  for (const eps of ['0', '-1']) {
    const rows = parsed([report(), report('A', eps, '2026-08-20', 'AP2'), report('A', '3', '2026-08-01', 'AP3')]);
    assert.equal(summarizeForecasts(rows, financial.publishedAt, now).pairs.length, 0);
  }
});

test('forecast and price comparisons stop after report, currency or share-basis changes', () => {
  for (const input of [{ ...valuation.input, currency: 'USD' }, { ...valuation.input, publishedAt: '2026-09-02' }, { ...valuation.input, priceDate: '2026-09-07' }, { ...valuation.input, shareBasisRisk: true }]) {
    const view = expectationView({ ...q, valuation: { ...valuation, input }, expectation: sample() }, now);
    assert.equal(view.key, 'incomparable'); assert.equal(view.hurdle, undefined);
  }
});

test('unverified or missing forecasts lower caps and never create positive confirmation', () => {
  for (const expectation of [undefined, sample()]) {
    const result = decisionView({ ...q, valuation, expectation }, now);
    assert.equal(result.priority, false); assert.equal(result.plan.maxPositionPct, 5);
  }
  const fair = { ...valuation, state: 'fair' };
  assert.equal(decisionView({ ...q, valuation: fair, expectation: sample() }, now).plan.maxPositionPct, 2.5);
});

test('adverse forecasts veto plans while favorable forecasts cannot undo existing vetoes', () => {
  const e = sample('0.1');
  assert.equal(decisionView({ ...q, valuation, expectation: e }, now).plan, null);
  const good = { ...sample('2'), basisVerified: true };
  assert(decisionView({ ...q, valuation, expectation: good }, now).priority);
  for (const change of [{ valuation: { ...valuation, state: 'premium' } }, { status: 'avoid', plan: null }, { valuation: { ...valuation, qualityFlags: ['cash'] } }]) {
    assert.equal(decisionView({ ...q, valuation, expectation: good, ...change }, now).plan, null);
  }
});

test('three same-broker material downward changes are required for revision veto', () => {
  const rows = Array.from({ length: 3 }, (_, i) => [report(`org${i}`, '2', '2026-09-01', `AP20260901${i}`), report(`org${i}`, '3', '2026-08-20', `AP20260820${i}`)]).flat();
  const e = summarizeForecasts(parsed(rows), financial.publishedAt, now);
  assert.equal(e.pairs.length, 3);
  assert.equal(expectationView({ ...q, valuation, expectation: e }, now).key, 'down');
  assert.equal(decisionView({ ...q, valuation, expectation: e }, now).plan, null);
});

test('large dispersion lowers exposure without manufacturing consensus', () => {
  const e = summarizeForecasts(parsed([report('A', '1', '2026-09-01', 'AP1'), report('B', '2', '2026-09-01', 'AP2'), report('C', '3', '2026-09-01', 'AP3')]), financial.publishedAt, now);
  assert.equal(expectationView({ ...q, valuation, expectation: e }, now).key, 'divided');
  assert.equal(decisionView({ ...q, valuation, expectation: e }, now).plan.maxPositionPct, 5);
});

test('collector does not query unsupported assets or silently accept incomplete pagination', async () => {
  let calls = 0;
  const values = await collectExpectations([{ ...q, market: 'US' }, { ...q, type: '现货' }], async () => { calls++; }, now);
  assert.equal(calls, 0); assert(values.every(e => e.status === 'unavailable'));
  const failed = await collectExpectations([{ ...q, valuation }], async () => ({ ...body([report()]), TotalPage: 4 }), now);
  assert.equal(failed[0].status, 'unavailable');
});
