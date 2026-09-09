import test from 'node:test';
import assert from 'node:assert/strict';
import { earningsValue, valueBand, buildEquityValue, investmentView, valuationFresh } from '../src/valuation.js';
import { cnEarnings, usEarnings, issuerMetrics } from './fetch-valuation.js';
const now = Date.parse('2026-09-09T07:00:00Z');
const q = { key: 'cypc', type: '股票', currency: 'CNY', price: 10, quoteDate: '2026-09-08', status: 'ready', plan: { maxPositionPct: 10 } };
const input = { reportDate: '2026-06-30', publishedAt: '2026-08-20', annualDate: '2025-12-31', currency: 'CNY', referencePrice: 10, priceDate: q.quoteDate, ttmEPS: 2.2, annualEPS: 2, cashConversion: 1.2, debtRatio: 55 };
test('earnings valuation is discounted terminal earnings, not undiscounted future price', () => {
  assert(Math.abs(earningsValue(2, 10, 20, 10) - 40) < 1e-10);
  assert(earningsValue(2, 10, 20, 15) < 40);
  assert(earningsValue(2, 15, 20, 10) > 40);
  assert.equal(earningsValue(-1, 10, 20, 10), null);
  assert.equal(earningsValue(2, 10, 20, -1), null);
});
test('margin of safety and upside have different denominators', () => {
  const x = valueBand(80, 100, 85, 130);
  assert.equal(x.margin, 20); assert.equal(x.upside, 25); assert.equal(x.state, 'deep');
  assert.equal(valueBand(160, 100, 85, 130).state, 'expensive');
});
test('base earnings do not extrapolate peak or annualize a half-year', () => {
  const v = buildEquityValue(q, input, now);
  assert.equal(v.status, 'ok'); assert.equal(v.normalizedEPS, 2);
  assert(v.scenarios[0].value < v.scenarios[1].value && v.scenarios[1].value < v.scenarios[2].value);
  const s = v.scenarios[1];
  const rebuilt = s.eps * (1 + v.impliedGrowth / 100) ** 5 * s.terminalPE / (1 + s.discount / 100) ** 5;
  assert(Math.abs(rebuilt - input.referencePrice) < 0.001);
});
test('a value discount cannot override a weak technical setup', () => {
  const valuation = buildEquityValue(q, input, now);
  assert(investmentView({ ...q, valuation }, now).priority);
  assert.equal(investmentView({ ...q, status: 'avoid', plan: null, valuation }, now).key, 'valuewatch');
  assert.equal(investmentView({ ...q, status: 'avoid', plan: null, valuation }, now).plan, null);
});
test('expensive or poor quality cancels even a strong breakout plan', () => {
  const expensive = buildEquityValue({ ...q, price: 100 }, { ...input, referencePrice: 100 }, now);
  assert.equal(investmentView({ ...q, valuation: expensive }, now).plan, null);
  const weakCash = buildEquityValue(q, { ...input, cashConversion: 0.3 }, now);
  assert.equal(investmentView({ ...q, valuation: weakCash }, now).key, 'quality');
  assert.equal(investmentView({ ...q, valuation: weakCash }, now).plan, null);
});
test('old value inputs cannot resurrect a cancelled stock plan', () => {
  const v = buildEquityValue(q, input, now);
  const late = Date.parse(v.expiresAt) + 1;
  assert(!valuationFresh(v, late));
  assert.equal(investmentView({ ...q, valuation: v }, late).plan, null);
  assert.equal(investmentView({ ...q, valuation: undefined }, now).plan, null);
});
test('losses, future reports, stale periods, currency and split mismatches fail closed', () => {
  for (const change of [{ ttmEPS: -1 }, { annualEPS: null }, { publishedAt: '2026-12-01' }, { reportDate: '2024-12-31' }, { currency: 'USD' }, { priceDate: '2026-09-07' }, { shareBasisRisk: true }]) {
    assert.equal(buildEquityValue(q, { ...input, ...change }, now).status, 'unavailable');
  }
});
test('CN TTM uses annual plus current cumulative minus comparable prior period', () => {
  const row = (end, eps) => ({ REPORT_DATE: end, NOTICE_DATE: '2026-08-20', EPSXS: eps, PARENTNETPROFIT: eps * 1000, MGJYXJJE: eps * 1.2, CURRENCY: 'CNY', ZCFZL: 50, ROEJQ: 10 });
  const rows = [row('2026-06-30', 1.5), row('2025-12-31', 2), row('2025-06-30', 1)];
  assert.equal(cnEarnings(rows, now).ttmEPS, 2.5);
  assert.throws(() => cnEarnings(rows.slice(0, 2), now), /缺少/);
  assert(cnEarnings([{ ...rows[0], PARENTNETPROFIT: 3000 }, ...rows.slice(1)], now).shareBasisRisk);
});
test('US quarterly extraction excludes cumulative and annual double-counting', () => {
  const row = (start, end, eps, type = '单季报') => ({ START_DATE: start, REPORT_DATE: end, NOTICE_DATE: '2026-08-20', DILUTED_EPS: eps, PARENT_HOLDER_NETPROFIT: eps * 1000, DATE_TYPE: type, CURRENCY_ABBR: 'USD' });
  const rows = [row('2026-04-01', '2026-06-30', 4), row('2026-01-01', '2026-03-31', 3), row('2025-10-01', '2025-12-31', 2), row('2025-07-01', '2025-09-30', 1), row('2025-07-01', '2026-06-30', 10, '年报'), row('2025-07-01', '2026-03-31', 6, '累计季报')];
  assert.equal(usEarnings(rows, now).ttmEPS, 10);
  assert.throws(() => usEarnings([{ ...rows[0], START_DATE: '2026-03-01' }, ...rows.slice(1)], now), /异常|重叠/);
  assert.throws(() => usEarnings(rows.slice(1), now), /缺少/);
});
test('fund NAV discounts and gold/BTC do not become intrinsic value confirmations', () => {
  const valuation = { kind: 'fund', status: 'ok', checkedAt: new Date(now).toISOString(), expiresAt: '2026-09-15', navPremium: -5 };
  assert.equal(investmentView({ ...q, type: '宽基ETF', valuation }, now).priority, false);
  assert.equal(investmentView({ ...q, type: '现货', valuation: { kind: 'noncash', status: 'not_applicable' } }, now).priority, false);
});
test('issuer metrics read structured dates and do not infer valuation from loose text', () => {
  const data = { values: [{ label: 'P/E Ratio', value: 22, asOfDate: 20260908 }, { label: 'Effective Duration', value: 15, asOfDate: 20260904 }] };
  const attr = JSON.stringify(data).replaceAll('"', '&quot;');
  assert.deepEqual(issuerMetrics(`<walrus-render-on-client componentprops="${attr}"></walrus-render-on-client>`), [{ name: 'P/E Ratio', value: 22, date: '2026-09-08' }, { name: 'Effective Duration', value: 15, date: '2026-09-04' }]);
  assert.deepEqual(issuerMetrics('<p>P/E Ratio 22 Sep 8 2026</p>'), []);
});
