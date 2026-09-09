import { load } from 'cheerio';
import { buildEquityValue } from '../src/valuation.js';
const DAY = 86_400_000;
const num = x => x === null || x === undefined || x === '' ? NaN : Number(x);
const date = x => String(x || '').slice(0, 10);
const positive = x => Number.isFinite(x) && x > 0;

function publishedRows(rows, now) {
  const seen = new Set();
  return rows.filter(r => Number.isFinite(Date.parse(r.NOTICE_DATE)) && Date.parse(r.NOTICE_DATE) <= now && Date.parse(r.REPORT_DATE) <= now)
    .sort((a, b) => b.REPORT_DATE.localeCompare(a.REPORT_DATE) || b.NOTICE_DATE.localeCompare(a.NOTICE_DATE))
    .filter(r => { const key = `${r.REPORT_DATE}:${r.DATE_TYPE || ''}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

export function cnEarnings(rows, now = Date.now()) {
  const clean = publishedRows(rows, now);
  const latest = clean[0];
  if (!latest) throw new Error('未找到已披露财报');
  const year = Number(date(latest.REPORT_DATE).slice(0, 4));
  const annual = clean.find(r => date(r.REPORT_DATE).endsWith('12-31') && r.REPORT_DATE <= latest.REPORT_DATE);
  const prior = clean.find(r => date(r.REPORT_DATE) === `${year - 1}${date(latest.REPORT_DATE).slice(4)}`);
  if (!annual || (latest !== annual && (!prior || Number(date(annual.REPORT_DATE).slice(0, 4)) !== year - 1))) throw new Error('TTM缺少上年年报或上年同期，禁止半年利润直接乘2');
  const ttm = field => latest === annual ? num(annual[field]) : num(annual[field]) + num(latest[field]) - num(prior[field]);
  const annualEPS = num(annual.EPSXS);
  const ttmEPS = ttm('EPSXS');
  const impliedAnnualShares = num(annual.PARENTNETPROFIT) / annualEPS;
  const impliedLatestShares = num(latest.PARENTNETPROFIT) / num(latest.EPSXS);
  const cashPerShare = ttm('MGJYXJJE');
  return {
    reportDate: date(latest.REPORT_DATE), publishedAt: date(latest.NOTICE_DATE), annualDate: date(annual.REPORT_DATE), currency: latest.CURRENCY,
    ttmEPS, annualEPS, cashConversion: positive(ttmEPS) ? cashPerShare / ttmEPS : null,
    roe: num(latest.ROEJQ), debtRatio: num(latest.ZCFZL),
    shareBasisRisk: !positive(impliedAnnualShares) || !positive(impliedLatestShares) || Math.abs(impliedLatestShares / impliedAnnualShares - 1) > 0.1,
    periods: (latest === annual ? [annual] : [annual, latest, prior]).map(r => ({ start: `${date(r.REPORT_DATE).slice(0, 4)}-01-01`, end: date(r.REPORT_DATE), eps: num(r.EPSXS), publishedAt: date(r.NOTICE_DATE) })),
    basis: '摊薄EPS：最新年报+本年累计-上年同期；基准盈利取TTM和最新年报较低值。经营现金流/每股收益为近似质量检查，不等于股东自由现金流。'
  };
}

export function usEarnings(rows, now = Date.now()) {
  const clean = publishedRows(rows, now);
  const quarters = clean.filter(r => r.DATE_TYPE === '单季报').slice(0, 4);
  const annual = clean.find(r => r.DATE_TYPE === '年报');
  if (quarters.length !== 4 || !annual) throw new Error('缺少连续四个单季与最新年报');
  const ascending = [...quarters].reverse();
  for (let i = 0; i < ascending.length; i++) {
    const r = ascending[i];
    const length = Date.parse(date(r.REPORT_DATE)) - Date.parse(date(r.START_DATE));
    if (length < 70 * DAY || length > 105 * DAY) throw new Error('单季期间长度异常');
    if (i && Date.parse(date(r.START_DATE)) - Date.parse(date(ascending[i - 1].REPORT_DATE)) !== DAY) throw new Error('季度存在缺口或重叠');
  }
  const shares = quarters.map(r => num(r.PARENT_HOLDER_NETPROFIT) / num(r.DILUTED_EPS));
  return {
    reportDate: date(quarters[0].REPORT_DATE), publishedAt: date(quarters[0].NOTICE_DATE), annualDate: date(annual.REPORT_DATE), currency: quarters[0].CURRENCY_ABBR,
    ttmEPS: quarters.reduce((sum, r) => sum + num(r.DILUTED_EPS), 0), annualEPS: num(annual.DILUTED_EPS),
    cashConversion: null, roe: num(quarters[0].ROE_AVG), debtRatio: num(quarters[0].DEBT_ASSET_RATIO),
    shareBasisRisk: shares.some(n => !positive(n)) || Math.max(...shares) / Math.min(...shares) > 1.2,
    periods: ascending.map(r => ({ start: date(r.START_DATE), end: date(r.REPORT_DATE), eps: num(r.DILUTED_EPS), publishedAt: date(r.NOTICE_DATE) })),
    basis: '最近四个连续单季GAAP摊薄EPS相加；不用累计季报重复加总。基准盈利取TTM和最新年报较低值，拆股或大幅股本变化会暂停。'
  };
}

async function stockInput(q, json) {
  const secucode = q.market === 'CN' ? `${q.symbol}.${q.providerSymbol.startsWith('sh') ? 'SH' : 'SZ'}` : `${q.symbol}.O`;
  const report = q.market === 'CN' ? 'RPT_F10_FINANCE_MAINFINADATA' : 'RPT_USF10_FN_GMAININDICATOR';
  const params = new URLSearchParams({ reportName: report, columns: 'ALL', filter: `(SECUCODE="${secucode}")`, pageSize: '20', sortColumns: 'REPORT_DATE', sortTypes: '-1' });
  const sourceUrl = `https://datacenter.eastmoney.com/securities/api/data/v1/get?${params}`;
  const body = await json(sourceUrl);
  if (!body.success || !Array.isArray(body.result?.data)) throw new Error('财报数据源未返回结构化数据');
  const input = q.market === 'CN' ? cnEarnings(body.result.data) : usEarnings(body.result.data);
  const priceUrl = q.market === 'CN' ? `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${q.providerSymbol},day,,,120,bfq` : q.sourceUrl;
  const priceBody = await json(priceUrl);
  const node = priceBody.data?.[q.providerSymbol];
  let referencePrice;
  if (q.market === 'CN') referencePrice = num(node?.day?.find(r => r[0] === q.quoteDate)?.[2]);
  else {
    const quote = node?.qt?.[q.providerSymbol];
    if (date(quote?.[30]) === q.quoteDate) referencePrice = num(quote[3]);
  }
  if (!positive(referencePrice)) throw new Error('未取得与技术日线同日的未复权收盘价');
  return { ...input, referencePrice, priceDate: q.quoteDate, source: '东方财富财报汇总 / 腾讯未复权收盘', sourceUrl, priceSourceUrl: priceUrl };
}

export function issuerMetrics(html) {
  const $ = load(html);
  const found = new Map();
  const wanted = new Set(['P/E Ratio', 'P/B Ratio', 'Effective Duration', '30 Day SEC Yield', 'NAV as of']);
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (wanted.has(node.label) && positive(num(node.value))) {
      const d = String(node.asOfDate || '');
      if (/^\d{8}$/.test(d)) found.set(node.label, { name: node.label, value: num(node.value), date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` });
    }
    if (node.name === 'NAV as of' && positive(num(node.value))) {
      const parsed = Date.parse(node.valueReference?.value);
      if (Number.isFinite(parsed)) found.set(node.name, { name: node.name, value: num(node.value), date: new Date(parsed).toISOString().slice(0, 10) });
    }
    for (const value of Object.values(node)) if (typeof value === 'object') visit(value);
  };
  $('walrus-render-on-client[componentprops]').each((_, el) => { try { visit(JSON.parse($(el).attr('componentprops'))); } catch { /* Other components need not contain financial data. */ } });
  $('script[type="application/ld+json"]').each((_, el) => { try { visit(JSON.parse($(el).text())); } catch { /* Ignore malformed unrelated metadata. */ } });
  return [...found.values()];
}

async function fundAnchor(q, json, request) {
  const now = Date.now();
  const base = { kind: 'fund', status: 'unavailable', label: '底层长期估值未覆盖', checkedAt: new Date(now).toISOString(), metrics: [], reason: 'ETF长期价值取决于底层盈利、增长与现金流；净值折价只描述交易价格偏离，不能证明底层资产便宜。' };
  if (['soxx', 'tlt'].includes(q.key)) {
    const sourceUrl = q.key === 'soxx' ? 'https://www.ishares.com/us/products/239705/ishares-phlx-semiconductor-etf' : 'https://www.ishares.com/us/products/239454/ishares-20-year-treasury-bond-etf';
    const metrics = issuerMetrics(await request(sourceUrl)).filter(m => Date.parse(m.date) <= now && now - Date.parse(m.date) <= 7 * DAY);
    if (!metrics.length) return { ...base, reason: '发行人估值或久期数据超出7日窗口。', sourceUrl };
    const duration = metrics.find(m => m.name === 'Effective Duration');
    const nav = metrics.find(m => m.name === 'NAV as of' && m.date === q.quoteDate);
    const navPremium = nav && positive(q.referenceClose) ? (q.referenceClose / nav.value - 1) * 100 : null;
    return { ...base, status: 'ok', kind: q.key === 'tlt' ? 'bond' : 'fund', label: q.key === 'tlt' ? '收益率 / 久期参考' : '底层估值倍数参考', source: 'iShares发行人', sourceUrl, metrics, navPremium,
      expiresAt: new Date(Math.min(...metrics.map(m => Date.parse(m.date))) + 7 * DAY).toISOString(),
      rateShock: duration ? [-1, 0, 1].map(change => ({ rateChange: change, priceChangePct: -duration.value * change })) : null,
      reason: q.key === 'tlt' ? '债券价值来自票息和本金折现；久期仅估算收益率平行移动的价格敏感度，不含凸性、票息或总回报。滚动债券ETF没有到期兑付面值。' : `${base.reason} 发行人P/E排除负盈利成份股，不能直接反推全组合可分配盈利。` };
  }
  if (q.market === 'CN') {
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${q.symbol}&pageIndex=1&pageSize=5`;
    const body = await json(url, { headers: { referer: `https://fundf10.eastmoney.com/jjjz_${q.symbol}.html` } });
    const nav = body.Data?.LSJZList?.find(r => r.FSRQ === q.quoteDate && positive(num(r.DWJZ)));
    if (nav) {
      const prices = await json(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${q.providerSymbol},day,,,120,bfq`);
      const close = num(prices.data?.[q.providerSymbol]?.day?.find(r => r[0] === nav.FSRQ)?.[2]);
      return { ...base, status: 'ok', label: '净值偏离参考，非长期价值', source: '东方财富基金净值 / 腾讯未复权收盘', sourceUrl: url, metrics: [{ name: 'NAV as of', value: num(nav.DWJZ), date: nav.FSRQ }],
        navPremium: positive(close) ? (close / num(nav.DWJZ) - 1) * 100 : null, expiresAt: new Date(Date.parse(nav.FSRQ) + 4 * DAY).toISOString() };
    }
  }
  return base;
}

export async function collectValuations(quotes, json, request) {
  return Promise.all(quotes.map(async q => {
    try {
      if (!q.ok) return { kind: 'missing', status: 'unavailable', label: '价格数据不足', reason: '没有有效价格，暂停价值比较。' };
      if (q.type === '股票') return buildEquityValue(q, await stockInput(q, json));
      if (q.key === 'btc' || q.key === 'gld') return { kind: 'noncash', status: 'not_applicable', label: '无可靠现金流价值锚',
        reason: q.key === 'btc' ? 'BTC没有企业利润、股息或合约现金流，无法据此计算DCF。链上MVRV等相对成本指标也不等于内在价值；当前不发布长期目标价。' : '黄金不产生经营现金流，价值取决于持有需求、实际利率和稀缺性。GLD净值反映黄金价格，不证明黄金本身被低估。' };
      return await fundAnchor(q, json, request);
    } catch (e) { return { kind: q.type === '股票' ? 'earnings' : 'fund', status: 'unavailable', label: '价值数据不足', reason: e.message, checkedAt: new Date().toISOString() }; }
  }));
}
