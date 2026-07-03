import fs from 'node:fs';

const file = 'public/data/market.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const errors = [];

function requireValue(condition, message) {
  if (!condition) errors.push(message);
}

function quote(key) {
  return data.quotes.find((q) => q.key === key);
}

function isPause(rec) {
  return rec?.action === '\u6682\u505c\u5224\u65ad';
}

function isUsable(q, history = false) {
  return Boolean(q && q.ok && !q.stale && Number.isFinite(q.price) && (!history || q.historyOk));
}

requireValue(data.generatedAt, 'generatedAt missing');
requireValue(data.generatedAtCN, 'generatedAtCN missing');
requireValue(Array.isArray(data.quotes) && data.quotes.length >= 10, 'quotes missing or too small');
requireValue(data.recommendations?.aShare, 'aShare recommendation missing');
requireValue(data.recommendations?.usStock, 'usStock recommendation missing');
requireValue(data.recommendations?.btc, 'btc recommendation missing');
requireValue(data.quality, 'quality block missing');
requireValue(Array.isArray(data.nowcast) && data.nowcast.length >= 4, 'nowcast module missing');
requireValue(Array.isArray(data.impliedPricing) && data.impliedPricing.length >= 4, 'impliedPricing module missing');
requireValue(Array.isArray(data.marketTraces) && data.marketTraces.length >= 4, 'marketTraces module missing');
requireValue(data.publicDisclosure, 'publicDisclosure module missing');
requireValue(Array.isArray(data.leadLagChain) && data.leadLagChain.length >= 4, 'leadLagChain module missing');
requireValue(Array.isArray(data.playbook) && data.playbook.length >= 3, 'playbook module missing');
requireValue(data.macroPricing?.series?.length >= 5, 'macroPricing series missing');

for (const q of data.quotes || []) {
  requireValue(typeof q.key === 'string' && q.key.length > 0, 'quote key missing');
  requireValue(typeof q.group === 'string' && q.group.length > 0, `${q.key} group missing`);
  requireValue(typeof q.name === 'string' && q.name.length > 0, `${q.key} name missing`);
  requireValue('ok' in q, `${q.key} ok missing`);
  requireValue('stale' in q, `${q.key} stale missing`);
  requireValue('source' in q, `${q.key} source missing`);
  requireValue('quoteDate' in q, `${q.key} quoteDate missing`);
  if (q.ok) {
    requireValue(Number.isFinite(q.price), `${q.key} ok=true but price invalid`);
    requireValue(!q.stale, `${q.key} ok=true but stale=true`);
  }
}

const aOk = [quote('sse'), quote('szse'), quote('chinext')].filter((q) => isUsable(q, true)).length;
const usOk = [quote('nasdaq'), quote('qqq'), quote('spx')].filter((q) => isUsable(q)).length + (isUsable(quote('vix')) ? 1 : 0);
const btcOk = isUsable(quote('btc'), true);

if (aOk < 2 || !isUsable(quote('sse'), true)) {
  requireValue(isPause(data.recommendations.aShare), 'A-share data failed quorum but recommendation is not paused');
}

if (usOk < 3) {
  requireValue(isPause(data.recommendations.usStock), 'US stock data failed quorum but recommendation is not paused');
}

if (!btcOk) {
  requireValue(isPause(data.recommendations.btc), 'BTC history data failed but recommendation is not paused');
}

for (const [name, rec] of Object.entries(data.recommendations || {})) {
  requireValue(Number.isFinite(rec.confidence), `${name} confidence invalid`);
  requireValue(rec.confidence >= 0 && rec.confidence <= 100, `${name} confidence out of range`);
  requireValue(Array.isArray(rec.reasons) && rec.reasons.length >= 2, `${name} reasons too short`);
  requireValue(Array.isArray(rec.invalidations) && rec.invalidations.length >= 2, `${name} invalidations too short`);
}

for (const item of data.nowcast || []) {
  requireValue(Number.isFinite(item.score), `nowcast ${item.key} score invalid`);
  requireValue(Array.isArray(item.evidence) && item.evidence.length > 0, `nowcast ${item.key} evidence missing`);
}

for (const item of data.impliedPricing || []) {
  requireValue(item.name && item.read, `impliedPricing ${item.key} incomplete`);
}

for (const item of data.marketTraces || []) {
  requireValue(item.name && item.signal && item.action, `marketTrace ${item.key} incomplete`);
}

if (data.publicDisclosure) {
  requireValue(typeof data.publicDisclosure.legalBoundary === 'string' && data.publicDisclosure.legalBoundary.length > 0, 'publicDisclosure legalBoundary missing');
  requireValue(data.publicDisclosure.china?.status, 'publicDisclosure china status missing');
  requireValue(Array.isArray(data.publicDisclosure.china?.items), 'publicDisclosure china items missing');
  requireValue(data.publicDisclosure.us?.status, 'publicDisclosure us status missing');
  requireValue(Array.isArray(data.publicDisclosure.us?.sources) && data.publicDisclosure.us.sources.length >= 2, 'publicDisclosure us sources missing');
  requireValue(Array.isArray(data.publicDisclosure.tradeUse) && data.publicDisclosure.tradeUse.length >= 2, 'publicDisclosure tradeUse missing');
  for (const item of data.publicDisclosure.china?.items || []) {
    requireValue(item.title && item.url && item.source, `publicDisclosure china item ${item.id || item.code} incomplete`);
  }
}

if (errors.length) {
  console.error(errors.map((x) => `- ${x}`).join('\n'));
  process.exit(1);
}

console.log(`validated ${file}`);
