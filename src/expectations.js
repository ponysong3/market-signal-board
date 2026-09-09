import { valuationFresh } from './valuation.js';

const DAY = 86_400_000;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const number = x => x === null || x === undefined || String(x).trim() === '' ? NaN : Number(x);
export const median = values => {
  const x = values.filter(finite).sort((a, b) => a - b);
  return x.length ? (x[Math.floor((x.length - 1) / 2)] + x[Math.floor(x.length / 2)]) / 2 : null;
};
const dateTime = date => Date.parse(`${date}T00:00:00+08:00`);
const isoDate = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(dateTime(x)) && new Date(dateTime(x) + 8 * 3_600_000).toISOString().slice(0, 10) === x;

// Relative provider columns are accepted only inside the same publication year.
export function normalizeForecasts(body, item, now = Date.now()) {
  const year = Number(body.currentYear);
  const currentYear = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(now));
  if (!Array.isArray(body.data) || year !== currentYear) throw new Error('预测年度缺失或跨年字段无法核对');
  const rows = new Map();
  for (const r of body.data) {
    const date = String(r.publishDate || '').slice(0, 10);
    const age = now - dateTime(date);
    if (String(r.stockCode) !== item.symbol || !isoDate(date) || Number(date.slice(0, 4)) !== year || age < 0 || age >= 90 * DAY) continue;
    if (!r.orgCode || !r.orgName || !/^AP\d+$/.test(r.infoCode || '')) continue;
    const eps = number(r.predictNextYearEps);
    if (!finite(eps)) continue;
    rows.set(r.infoCode, { id: r.infoCode, orgId: String(r.orgCode), org: String(r.orgSName || r.orgName), date,
      fiscalYear: year + 1, eps, currency: 'CNY', basis: '供应商研报EPS（基本/摊薄口径未逐份核验）',
      url: `https://data.eastmoney.com/report/zw_stock.jshtml?infocode=${r.infoCode}` });
  }
  return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export function summarizeForecasts(rows, financialDate, now = Date.now()) {
  if (!isoDate(financialDate)) throw new Error('最新财报发布日期缺失，无法剔除财报前预测');
  const groups = new Map();
  for (const r of rows) {
    if (!isoDate(r.date) || !finite(r.eps) || now < dateTime(r.date) || now - dateTime(r.date) >= 90 * DAY) continue;
    const key = `${r.orgId}:${r.fiscalYear}:${r.currency}:${r.basis}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  const samples = [], pairs = [];
  for (const group of groups.values()) {
    group.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    const latest = group[0];
    if (now - dateTime(latest.date) >= 45 * DAY || latest.date < financialDate) continue;
    // Conflicting forecasts from the same institution on the same day are ambiguous.
    if (group.some(r => r.date === latest.date && r.eps !== latest.eps)) continue;
    samples.push(latest);
    const previous = group.find(r => dateTime(latest.date) - dateTime(r.date) >= 7 * DAY);
    if (previous?.eps > 0 && !group.some(r => r.date === previous.date && r.eps !== previous.eps)) pairs.push({ org: latest.org, orgId: latest.orgId, fiscalYear: latest.fiscalYear, from: previous.date, to: latest.date, before: previous.eps, after: latest.eps, changePct: (latest.eps / previous.eps - 1) * 100, previousUrl: previous.url, currentUrl: latest.url });
  }
  if (!samples.length) throw new Error('最新财报后45日窗口内无有效预测样本');
  if (new Set(samples.map(r => `${r.fiscalYear}:${r.currency}:${r.basis}`)).size !== 1) throw new Error('预测年度、币种或每股口径混杂');
  samples.sort((a, b) => b.date.localeCompare(a.date) || a.orgId.localeCompare(b.orgId));
  const values = samples.map(r => r.eps);
  const mid = median(values);
  return { status: 'ok', kind: 'broker_sample', checkedAt: new Date(now).toISOString(),
    expiresAt: new Date(Math.min(...samples.map(r => dateTime(r.date) + 45 * DAY))).toISOString(),
    fiscalYear: samples[0].fiscalYear, currency: samples[0].currency, financialDate,
    asOf: samples[0].date, oldestDate: samples.at(-1).date, count: samples.length,
    medianEPS: mid, minEPS: Math.min(...values), maxEPS: Math.max(...values),
    dispersionPct: mid > 0 ? (Math.max(...values) - Math.min(...values)) / mid * 100 : null,
    samples, pairs, revisionMedianPct: median(pairs.map(r => r.changePct)),
    source: '东方财富近期研报样本（非全市场一致预期）', sourceUrl: 'https://data.eastmoney.com/report/profitforecast.jshtml',
    basisVerified: false, reason: '机构各取最新一份；EPS口径与公司行动须打开研报复核。报告变化可能含股本调整，不等于纯经营预期修正。' };
}

export function expectationFresh(e, now = Date.now()) {
  return Boolean(e?.status === 'ok' && Date.parse(e.checkedAt) <= now + 60_000 && Date.parse(e.expiresAt) > now && dateTime(e.asOf) <= now);
}

// Compare one future fiscal-year EPS with the price hurdle at that SAME horizon.
export function priceHurdle(price, priceDate, fiscalYear, terminalPE, discount) {
  if (!isoDate(priceDate) || !Number.isInteger(fiscalYear) || ![price, terminalPE, discount].every(finite) || price <= 0 || terminalPE <= 0 || discount < 5 || discount > 25) return null;
  const years = (dateTime(`${fiscalYear}-12-31`) - dateTime(priceDate)) / (365.25 * DAY);
  if (years <= 0 || years > 3) return null;
  return { price, priceDate, fiscalYear, years, terminalPE, discount, requiredEPS: price * (1 + discount / 100) ** years / terminalPE };
}

export function expectationView(item, now = Date.now()) {
  const e = item.expectation;
  const v = item.valuation;
  if (item.type !== '股票') return { key: 'not_covered', label: '无个股盈利预期', supportive: false, reason: item.market === 'CRYPTO' ? 'BTC没有企业EPS；宏观定价仅作环境参考，未接入可核验的资金费率、期权偏斜和ETF净流量。' : '未覆盖组合底层盈利预测；宏观隐含通胀和波动预期不等于本标的涨跌预测。' };
  if (!expectationFresh(e, now)) return { key: 'missing', label: e?.status === 'ok' ? '研报预期已过期' : '机构预期待核验', supportive: false, reason: e?.status === 'ok' ? '旧研报不再参与价格比较，等待有效预测。' : e?.reason || '缺少有日期、有年度、可比较的机构预测。' };
  if (!valuationFresh(v, now) || v.input.currency !== e.currency || v.input.priceDate !== item.quoteDate || e.financialDate !== v.input.publishedAt || v.input.shareBasisRisk) return { key: 'incomparable', label: '预期与价格口径待核对', supportive: false, reason: '财报更新、估值时效、股本、币种或价格日期不一致，暂停预期差计算。' };
  const hurdle = priceHurdle(v.input.referencePrice, v.input.priceDate, e.fiscalYear, v.profile.pe[1], v.profile.discount[1]);
  if (!hurdle) return { key: 'incomparable', label: '预测期限不匹配', supportive: false, reason: '不能用一年预测增速对比五年价格隐含增速。' };
  const gapPct = (e.medianEPS / hurdle.requiredEPS - 1) * 100;
  const base = { supportive: false, hurdle, gapPct, referencePE: e.medianEPS > 0 ? hurdle.price / e.medianEPS : null };
  if (e.count < 3) return { ...base, key: 'thin', label: '预期样本偏少', reason: `仅${e.count}家有效机构，不用少量研报代表全市场。价差仅供核对。` };
  if (e.pairs.length >= 3 && e.revisionMedianPct <= -5) return { ...base, key: 'down', label: '同机构预测下调待复核', reason: '至少3组同年度报告EPS变动的中位数不高于-5%；先核查股本口径与经营变化，暂停新增。' };
  if (gapPct < -10 || e.medianEPS <= 0) return { ...base, key: 'demanding', label: '现价盈利门槛偏高', reason: '样本预测低于模型盈利门槛超过10%；需要更高盈利、更高退出倍数或更低回报要求才能支撑，暂停新增待复核。' };
  if (e.dispersionPct > 30) return { ...base, key: 'divided', label: '机构预测分歧较大', reason: '样本EPS极差超过中位数30%；降低仓位上限，不把中位数当作确定结果。' };
  if (!e.basisVerified) return { ...base, key: 'unverified', label: gapPct >= 10 ? '样本高于门槛，口径待核验' : '预期兑现空间有限', reason: '研报基本/摊薄EPS与公司行动尚未逐份核验；保留比较但不授予三重确认，已有可用计划仓位上限减半。' };
  return { ...base, key: gapPct >= 10 ? 'supported' : 'limited', label: gapPct >= 10 ? '样本预期支持' : '预期兑现空间有限', supportive: gapPct >= 10, reason: '同期限样本仅作独立参考，不证明尚未被市场定价；仍服从价值与技术限制。' };
}

export const CHECKS = {
  zijin: ['金铜售价、产量与单位成本是否共同支持利润预测？', '矿价回落、成本上升或项目延期能否使预测失效？'],
  cypc: ['来水、发电量、电价与财务费用能否兑现预测？', '枯水、购电成本和利率变化是否抵消收入增长？同时另核期间分红。'],
  zhongji: ['光模块出货、产品结构与毛利率能否支撑下一年度EPS？', '客户资本开支削减、竞争降价或扩产导致现金流落后于利润了吗？'],
  dongshan: ['新增订单转收入的速度、良率与利润率能否支持预测？', '整合支出、资本开支和营运资金是否吞掉新增盈利？'],
  nvda: ['核对公司下一季收入指引、毛利率与客户AI资本开支，区分GAAP和非GAAP。', '需求延后、出口限制或竞争降价，是否使现价要求的五年增长过高？'],
  msft: ['核对Azure增长、商业订单及AI业务收入与资本开支。', '一次性投资收益是否抬高EPS？折旧和资本开支是否压低自由现金流？']
};
