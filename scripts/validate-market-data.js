import fs from 'node:fs';
import assert from 'node:assert/strict';
import { finite, quoteFresh, recentDisclosure, snapshotFresh, buildCandidate } from '../src/trading.js';
import { buildEquityValue, investmentView } from '../src/valuation.js';
import { expectationFresh, expectationView, summarizeForecasts } from '../src/expectations.js';
import { decisionView } from '../src/decision.js';

const data = JSON.parse(fs.readFileSync('public/data/market.json', 'utf8'));
assert.equal(data.schemaVersion, 4);
const generated = Date.parse(data.generatedAt);
assert(Number.isFinite(generated));
assert(snapshotFresh(data.generatedAt), 'Snapshot is older than 14 hours or from the future');
assert(Array.isArray(data.candidates) && data.candidates.length >= 3);
assert.equal(new Set(data.candidates.map(c => c.key)).size, data.candidates.length);
for (const c of data.candidates) {
  assert(c.name && c.symbol && c.market && c.currency);
  assert(c.valuation && c.valuation.status && c.valuation.kind);
  const e = c.expectation;
  assert(e && ['ok', 'unavailable'].includes(e.status), `${c.symbol}: expectation missing`);
  if (e.status === 'ok') {
    assert(expectationFresh(e, generated));
    assert.equal(new Set(e.samples.map(r => r.orgId)).size, e.count);
    const rebuilt = summarizeForecasts(e.samples, e.financialDate, generated);
    for (const field of ['medianEPS', 'minEPS', 'maxEPS', 'count', 'dispersionPct', 'expiresAt', 'fiscalYear']) assert.deepEqual(e[field], rebuilt[field], `${c.symbol}: ${field} expectation mismatch`);
    assert.equal(e.basisVerified, false, 'Public research EPS basis is not audited');
    for (const p of e.pairs) {
      assert(p.before > 0 && p.to > p.from && p.fiscalYear === e.fiscalYear);
      assert(Math.abs(p.changePct - (p.after / p.before - 1) * 100) < 1e-8);
    }
  }
  const combined = decisionView(c, generated);
  const expectation = expectationView(c, generated);
  if (['demanding', 'down'].includes(expectation.key)) assert.equal(combined.plan, null);
  if (combined.priority) assert(expectation.supportive && c.status === 'ready');
  if (combined.plan) assert(c.plan && combined.plan.maxPositionPct <= c.plan.maxPositionPct);
  const v = c.valuation;
  if (v.kind === 'earnings' && v.status === 'ok') {
    const expectedValue = buildEquityValue(c, v.input, generated);
    assert.deepEqual(v.scenarios, expectedValue.scenarios, `${c.symbol}: valuation scenarios mismatch`);
    assert.equal(v.margin, expectedValue.margin);
    assert.equal(v.state, expectedValue.state);
    const decision = investmentView(c, generated);
    if (['premium', 'expensive'].includes(v.state) || v.qualityFlags.length) assert.equal(decision.plan, null);
  }
  const benchmark = data.candidates.find(q => q.key === { CN: 'csi300', US: 'spy', CRYPTO: 'btc' }[c.market]);
  const expected = buildCandidate(c, benchmark, generated);
  assert.equal(c.status, expected.status, `${c.symbol}: incorrect eligibility`);
  assert.deepEqual(c.plan, expected.plan, `${c.symbol}: incorrect price plan`);
  if (c.plan) {
    assert(quoteFresh(c, generated) && quoteFresh(benchmark, generated));
    const p = c.plan;
    assert([p.entry, p.entryMax, p.stop, p.target, p.rr, p.lossPerUnit].every(finite));
    assert(p.stop > 0 && p.stop < p.entry && p.entry <= p.entryMax && p.entryMax < p.target);
    assert(p.rr >= 1.5 && p.maxPositionPct <= 20);
  }
  if (c.ok) {
    assert(c.sourceUrl?.startsWith('https://') && c.bars >= 65);
    assert(c.price > 0 && c.atr > 0 && c.ma20 > 0 && c.ma60 > 0);
  }
  if (c.status === 'blocked') assert.equal(c.plan, null);
}
for (const f of data.factors) {
  assert(f.ok && finite(f.value) && Date.parse(f.expiresAt) > generated && f.sourceUrl.startsWith('https://'));
}
for (const n of data.disclosures.items) {
  assert(recentDisclosure(n, generated), 'Outdated disclosure included');
  assert(n.url.startsWith('https://static.cninfo.com.cn/finalpage/'));
}
console.log(`Validated ${data.candidates.length} candidates, ${data.factors.length} factors and fresh disclosure window.`);
