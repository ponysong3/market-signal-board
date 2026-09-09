import fs from 'node:fs/promises';
import { collectValuations } from './fetch-valuation.js';
import { collectExpectations } from './fetch-expectations.js';
import { analyzeBars, buildCandidate, marketView, quoteFresh, recentDisclosure, DAY, SNAPSHOT_TTL } from '../src/trading.js';

const instruments = [
  ['csi300', 'CN', '沪深300ETF', '510300', 'sh510300', '宽基ETF', '中国大盘', 100, 0.001],
  ['chinext', 'CN', '创业板ETF', '159915', 'sz159915', '宽基ETF', '中国成长', 100, 0.001],
  ['chip', 'CN', '半导体ETF', '512480', 'sh512480', '行业ETF', '半导体', 100, 0.001],
  ['dividend', 'CN', '红利ETF', '510880', 'sh510880', '行业ETF', '红利', 100, 0.001],
  ['zijin', 'CN', '紫金矿业', '601899', 'sh601899', '股票', '资源', 100, 0.01],
  ['cypc', 'CN', '长江电力', '600900', 'sh600900', '股票', '公用事业', 100, 0.01],
  ['zhongji', 'CN', '中际旭创', '300308', 'sz300308', '股票', '算力光通信', 100, 0.01],
  ['dongshan', 'CN', '东山精密', '002384', 'sz002384', '股票', '电子制造', 100, 0.01],
  ['spy', 'US', 'SPDR 标普500ETF', 'SPY', 'usSPY.AM', '宽基ETF', '美国大盘', 1, 0.01],
  ['qqq', 'US', 'Invesco 纳指100ETF', 'QQQ', 'usQQQ.OQ', '宽基ETF', '美国成长', 1, 0.01],
  ['soxx', 'US', 'iShares 半导体ETF', 'SOXX', 'usSOXX.OQ', '行业ETF', '半导体', 1, 0.01],
  ['nvda', 'US', '英伟达', 'NVDA', 'usNVDA.OQ', '股票', 'AI芯片', 1, 0.01],
  ['msft', 'US', '微软', 'MSFT', 'usMSFT.OQ', '股票', '云计算', 1, 0.01],
  ['gld', 'US', 'SPDR 黄金ETF', 'GLD', 'usGLD.AM', '行业ETF', '黄金', 1, 0.01],
  ['tlt', 'US', 'iShares 长期美债ETF', 'TLT', 'usTLT.OQ', '行业ETF', '长期美债', 1, 0.01],
  ['btc', 'CRYPTO', '比特币现货', 'BTC/USDT', 'BTCUSDT', '现货', '比特币', 0.00001, 0.01]
].map(([key, market, name, symbol, providerSymbol, type, theme, lot, tick]) => ({ key, market, name, symbol, providerSymbol, type, theme, lot, tick, decimals: tick === 0.001 ? 3 : 2, currency: market === 'CN' ? 'CNY' : market === 'US' ? 'USD' : 'USDT' }));

async function request(url, options = {}) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { ...options, headers: { 'user-agent': 'Mozilla/5.0 MarketSignalBoard', ...options.headers }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (e) { last = e; }
  }
  throw last;
}
const json = async (url, options) => JSON.parse(await request(url, options));
const number = value => value === '' || value === null || value === undefined || value === '.' ? NaN : Number(value);
const cnDate = time => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' }).format(new Date(time));

async function equityQuote(item) {
  const route = item.market === 'CN' ? 'fqkline' : 'usfqkline';
  const url = `https://web.ifzq.gtimg.cn/appstock/app/${route}/get?param=${item.providerSymbol},day,,,120,qfq`;
  const body = await json(url);
  const node = body.data?.[item.providerSymbol];
  const raw = node?.qfqday || node?.day;
  if (!Array.isArray(raw)) throw new Error('日线接口未返回数据');
  const rows = raw.map(x => ({ date: x[0], open: number(x[1]), close: number(x[2]), high: number(x[3]), low: number(x[4]), volume: number(x[5]) }));
  const analysis = analyzeBars(item, rows);
  const rawQuote = node?.qt?.[item.providerSymbol];
  const referenceClose = item.market === 'US' && String(rawQuote?.[30]).slice(0, 10) === analysis.quoteDate ? number(rawQuote[3]) : null;
  return { ...analysis, referenceClose, source: '腾讯财经前复权日线', sourceUrl: url, fetchedAt: new Date().toISOString() };
}

async function cryptoQuote(item) {
  const urls = [
    'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=120',
    'https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=BTC_USDT&interval=1d&limit=120'
  ];
  const errors = [];
  for (const [i, url] of urls.entries()) {
    try {
      const body = await json(url);
      if (!Array.isArray(body)) throw new Error('未返回日线');
      const rows = body.map(x => i === 0 ? {
        date: new Date(Number(x[0])).toISOString().slice(0, 10), open: number(x[1]), high: number(x[2]), low: number(x[3]), close: number(x[4]), volume: number(x[5])
      } : {
        date: new Date(Number(x[0]) * 1000).toISOString().slice(0, 10), open: number(x[5]), high: number(x[3]), low: number(x[4]), close: number(x[2]), volume: number(x[6])
      });
      const q = analyzeBars(item, rows);
      if (!quoteFresh(q)) throw new Error('来源日线已过期');
      return { ...q, source: i === 0 ? 'Binance 公共现货日线' : 'Gate.io 公共现货日线', sourceUrl: url, fetchedAt: new Date().toISOString() };
    } catch (e) { errors.push(e.message); }
  }
  throw new Error(errors.join('；'));
}

async function collectQuote(item) {
  try { return await (item.market === 'CRYPTO' ? cryptoQuote(item) : equityQuote(item)); }
  catch (e) { return { ...item, ok: false, quoteDate: null, price: null, source: null, error: e.message }; }
}

const series = [
  { key: 'us10y', id: 'DGS10', name: '美国10年期国债收益率', unit: '%', maxDays: 7, meaning: '股票估值的折现率参考。上行会提高高估值资产的回报门槛。', exposure: 'QQQ / MSFT / NVDA / TLT' },
  { key: 'realYield', id: 'DFII10', name: '美国10年期实际利率', unit: '%', maxDays: 7, meaning: '扣除市场通胀定价后的利率。上行通常提高持有黄金等无息资产的机会成本。', exposure: 'GLD / BTC' },
  { key: 'inflation', id: 'T10YIE', name: '10年期通胀盈亏平衡率', unit: '%', maxDays: 7, meaning: '名义债与通胀保值债的收益率差，含风险和流动性溢价，不等于CPI预测。', exposure: 'GLD / TLT / 资源股' },
  { key: 'credit', id: 'BAMLH0A0HYM2', name: '美国高收益债信用利差', unit: '%', maxDays: 7, meaning: '企业融资压力的价格信号。持续走阔时，需要复核风险资产的新增敞口。', exposure: 'SPY / QQQ / BTC' }
];

export function parseSeriesCsv(text) {
  return text.trim().split(/\r?\n/).slice(1).map(line => {
    const [date, raw] = line.split(',');
    return { date, value: number(raw) };
  }).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.value)).sort((a, b) => a.date.localeCompare(b.date));
}

async function collectFactor(item) {
  try {
    const rows = parseSeriesCsv(await request(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${item.id}`));
    if (rows.length < 6) throw new Error('有效观测不足');
    const last = rows.at(-1);
    const age = Date.now() - Date.parse(`${last.date}T00:00:00Z`);
    if (age < 0 || age > item.maxDays * DAY) throw new Error('观测已超时效窗口');
    return { ...item, ok: true, value: last.value, change5obsBp: (last.value - rows.at(-6).value) * 100, quoteDate: last.date, expiresAt: new Date(Date.parse(last.date) + item.maxDays * DAY).toISOString(), source: `FRED ${item.id}`, sourceUrl: `https://fred.stlouisfed.org/series/${item.id}` };
  } catch (e) { return { ...item, ok: false, error: e.message }; }
}

async function collectVix() {
  const item = { key: 'vix', name: 'VIX 波动率指数', unit: '', maxDays: 5, meaning: '标普500期权隐含的未来30天波动预期。上行代表保护成本变贵，不是必跌信号。', exposure: 'SPY / QQQ', source: 'Cboe', sourceUrl: 'https://www.cboe.com/tradable_products/vix/' };
  try {
    const csv = await request('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv');
    const rows = csv.trim().split(/\r?\n/).slice(1).map(line => {
      const [date, , , , close] = line.split(',');
      const [mm, dd, yyyy] = date.split('/');
      return { date: `${yyyy}-${mm?.padStart(2, '0')}-${dd?.padStart(2, '0')}`, value: number(close) };
    }).filter(x => Number.isFinite(x.value) && x.value > 0);
    const last = rows.at(-1);
    if (!last || !quoteFresh({ market: 'US', ok: true, quoteDate: last.date })) throw new Error('最近应有收盘缺失');
    return { ...item, ...last, quoteDate: last.date, ok: true, expiresAt: new Date(Date.parse(last.date) + 5 * DAY).toISOString() };
  } catch (e) { return { ...item, ok: false, error: e.message }; }
}

async function collectDisclosures() {
  const start = cnDate(Date.now() - 6 * DAY);
  const end = cnDate(Date.now());
  const queries = ['配偶 买卖 股票', '亲属 短线交易', '董监高 增持'];
  const results = await Promise.allSettled(queries.map(async searchkey => {
    const form = new URLSearchParams({ pageNum: '1', pageSize: '30', column: 'szse', tabName: 'fulltext', plate: '', stock: '', searchkey, seDate: `${start}~${end}`, sortName: 'time', sortType: 'desc', isHLtitle: 'false' });
    const response = await json('https://www.cninfo.com.cn/new/hisAnnouncement/query', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', referer: 'https://www.cninfo.com.cn/' }, body: form });
    if (!Array.isArray(response.announcements) && response.totalAnnouncement !== 0) throw new Error('公告响应异常');
    return response.announcements || [];
  }));
  const items = new Map();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const ann of result.value) {
      const title = String(ann.announcementTitle || '').replace(/<[^>]*>/g, '').trim();
      if (/制度|办法|细则/.test(title) || !/买卖|短线交易|增持|减持/.test(title)) continue;
      const relative = String(ann.adjunctUrl || '');
      if (!/^finalpage\/[\w./-]+\.PDF$/i.test(relative)) continue;
      const item = { id: String(ann.announcementId), title, code: ann.secCode, issuer: ann.secName, date: cnDate(Number(ann.announcementTime)), url: `https://static.cninfo.com.cn/${relative}`, source: '巨潮资讯', meaning: '上市公司公开交易或治理事项，不代表政府官员持仓，也不能仅凭标题推断买卖方向或交易日期。' };
      if (recentDisclosure(item)) items.set(item.id, item);
    }
  }
  return { checkedAt: new Date().toISOString(), failedQueries: results.filter(x => x.status === 'rejected').length, items: [...items.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8) };
}

async function main() {
  const [quotes, factors, disclosures] = await Promise.all([
    Promise.all(instruments.map(collectQuote)),
    Promise.all([...series.map(collectFactor), collectVix()]),
    collectDisclosures()
  ]);
  const valuations = await collectValuations(quotes, json, request);
  const now = Date.now();
  const markets = ['CN', 'US', 'CRYPTO'].map(market => marketView(market, quotes, now));
  const candidates = quotes.map((q, i) => ({ ...buildCandidate(q, quotes.find(x => x.key === { CN: 'csi300', US: 'spy', CRYPTO: 'btc' }[q.market]), now), valuation: valuations[i] }));
  const expectations = await collectExpectations(candidates, json, now);
  candidates.forEach((c, i) => { c.expectation = expectations[i]; });
  const data = {
    schemaVersion: 4,
    generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SNAPSHOT_TTL).toISOString(),
    schedule: '每日北京时间 07:00 / 19:00，日线快照',
    strategy: '顺势突破 + 独立长期价值情景 + 有日期的研报样本与价格盈利门槛。研报不是全市场一致预期，模型假设不是市场共识；未经回测，评分不是胜率。',
    markets, candidates, factors: factors.filter(x => x.ok), disclosures,
    quality: {
      instruments: quotes.length, valid: quotes.filter(q => quoteFresh(q, now)).length,
      issues: [...quotes.filter(q => !quoteFresh(q, now)).map(q => ({ name: `${q.name} ${q.symbol}`, reason: q.error || `日线停留在 ${q.quoteDate}` })), ...factors.filter(f => !f.ok).map(f => ({ name: f.name, reason: f.error }))]
    }
  };
  await fs.mkdir('public/data', { recursive: true });
  await fs.writeFile('public/data/market.json', `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ generatedAt: data.generatedAt, valid: data.quality.valid, total: quotes.length, factors: data.factors.length, disclosures: disclosures.items.length, statuses: candidates.map(c => `${c.symbol}: ${c.status}`), issues: data.quality.issues }, null, 2));
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/update-market-data.js')) main().catch(e => { console.error(e); process.exitCode = 1; });
