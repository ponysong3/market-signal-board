import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const DAY_MS = 24 * 60 * 60 * 1000;

const ZH = {
  aShare: '\u0041\u80a1',
  usStock: '\u7f8e\u80a1',
  crypto: '\u52a0\u5bc6',
  factor: '\u5168\u7403\u56e0\u5b50',
  sse: '\u4e0a\u8bc1\u6307\u6570',
  szse: '\u6df1\u8bc1\u6210\u6307',
  chinext: '\u521b\u4e1a\u677f\u6307',
  dow: '\u9053\u743c\u65af',
  nasdaq: '\u7eb3\u65af\u8fbe\u514b',
  spx: '\u6807\u666e500',
  qqq: '\u7eb3\u6307100 ETF',
  vix: 'VIX \u6050\u614c\u6307\u6570',
  usdcny: '\u7f8e\u5143/\u4eba\u6c11\u5e01',
  oil: 'WTI \u539f\u6cb9',
  gold: '\u9ec4\u91d1',
  silver: '\u767d\u94f6',
  strong: '\u5f3a\u52bf',
  weak: '\u5f31\u52bf',
  shortStrong: '\u77ed\u5f3a',
  choppy: '\u9707\u8361',
  intradayStrong: '\u65e5\u5185\u504f\u5f3a',
  intradayWeak: '\u65e5\u5185\u504f\u5f31',
  insufficient: '\u6570\u636e\u4e0d\u8db3',
  abnormal: '\u6570\u636e\u5f02\u5e38',
  stale: '\u6570\u636e\u8fc7\u671f',
  degraded: '\u964d\u7ea7\u6570\u636e',
  dailyFx: '\u65e5\u9891\u6c47\u7387',
  add: '\u52a0\u4ed3',
  hold: '\u6301\u6709',
  reduce: '\u51cf\u4ed3',
  watch: '\u89c2\u671b',
  pause: '\u6682\u505c\u5224\u65ad'
};

const FRED_SERIES = [
  { key: 'us10y', name: 'US 10Y Treasury', id: 'DGS10', staleMaxDays: 7 },
  { key: 'us2y', name: 'US 2Y Treasury', id: 'DGS2', staleMaxDays: 7 },
  { key: 'breakeven10y', name: '10Y Breakeven Inflation', id: 'T10YIE', staleMaxDays: 7 },
  { key: 'hySpread', name: 'US High Yield OAS', id: 'BAMLH0A0HYM2', staleMaxDays: 7 },
  { key: 'nfci', name: 'Chicago Fed NFCI', id: 'NFCI', staleMaxDays: 14 }
];

const TENCENT_A = [
  { key: 'sse', group: ZH.aShare, name: ZH.sse, symbol: 'sh000001' },
  { key: 'szse', group: ZH.aShare, name: ZH.szse, symbol: 'sz399001' },
  { key: 'chinext', group: ZH.aShare, name: ZH.chinext, symbol: 'sz399006' }
];

const TENCENT_US = [
  { key: 'dow', group: ZH.usStock, name: ZH.dow, symbol: 'usDJI' },
  { key: 'nasdaq', group: ZH.usStock, name: ZH.nasdaq, symbol: 'usIXIC' },
  { key: 'spx', group: ZH.usStock, name: ZH.spx, symbol: 'usINX' },
  { key: 'qqq', group: ZH.usStock, name: ZH.qqq, symbol: 'usQQQ' },
  { key: 'vix', group: ZH.factor, name: ZH.vix, symbol: 'usVIX' }
];

const CRYPTO = [
  { key: 'btc', group: ZH.crypto, name: 'Bitcoin', symbol: 'BTC-USD', binance: 'BTCUSDT', gate: 'BTC_USDT', coinLoreId: 90, coinId: 'bitcoin' },
  { key: 'eth', group: ZH.crypto, name: 'Ethereum', symbol: 'ETH-USD', binance: 'ETHUSDT', gate: 'ETH_USDT', coinLoreId: 80, coinId: 'ethereum' }
];

const CNINFO_DISCLOSURE_QUERIES = [
  '\u4eb2\u5c5e \u4e70\u5356 \u80a1\u7968',
  '\u914d\u5076 \u4e70\u5356 \u80a1\u7968',
  '\u5b50\u5973 \u4e70\u5356 \u80a1\u7968',
  '\u77ed\u7ebf\u4ea4\u6613 \u4eb2\u5c5e',
  '\u8463\u76d1\u9ad8 \u8fd1\u4eb2\u5c5e'
];

const US_OFFICIAL_DISCLOSURE_SOURCES = [
  {
    name: 'US House Clerk Financial Disclosure',
    scope: 'Representatives, candidates, senior House staff, spouse/dependent child when reported by statutory forms',
    url: 'https://disclosures-clerk.house.gov/FinancialDisclosure',
    format: 'official search portal'
  },
  {
    name: 'US Senate eFD Search',
    scope: 'Senators, candidates, senior Senate staff, spouse/dependent child when reported by statutory forms',
    url: 'https://efdsearch.senate.gov/search/',
    format: 'official search portal'
  }
];

function avg(values) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function pct(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return ((a / b) - 1) * 100;
}

function clamp(n, min = 0, max = 100) {
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDateOnly(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function dateAgeDays(date) {
  if (!date) return Infinity;
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return Infinity;
  return Math.floor((Date.now() - t) / DAY_MS);
}

function isStale(date, maxAgeDays = 5) {
  return dateAgeDays(date) > maxAgeDays;
}

function trendLabel(price, ma20, ma60) {
  if (!Number.isFinite(price) || !Number.isFinite(ma20) || !Number.isFinite(ma60)) return ZH.insufficient;
  if (price > ma20 && ma20 > ma60) return ZH.strong;
  if (price > ma20) return ZH.shortStrong;
  if (price < ma20 && ma20 < ma60) return ZH.weak;
  return ZH.choppy;
}

function trendFromReturns(day, r20) {
  if (!Number.isFinite(day) && !Number.isFinite(r20)) return ZH.insufficient;
  if (Number.isFinite(r20) && r20 >= 2) return ZH.strong;
  if (Number.isFinite(r20) && r20 <= -2) return ZH.weak;
  if (Number.isFinite(day) && day >= 0) return ZH.intradayStrong;
  if (Number.isFinite(day) && day < 0) return ZH.intradayWeak;
  return ZH.choppy;
}

async function httpText(url, options = {}) {
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 12000;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 market-signal-board/0.2',
          accept: options.accept || '*/*'
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (/requires JavaScript to verify/i.test(text)) throw new Error('blocked by JS challenge');
      return text;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(500 * attempt);
    }
  }
  throw lastError;
}

async function httpJson(url, options = {}) {
  return JSON.parse(await httpText(url, { ...options, accept: 'application/json,*/*' }));
}

async function httpPostFormJson(url, form, options = {}) {
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 12000;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'user-agent': 'Mozilla/5.0 market-signal-board/0.2',
          accept: 'application/json,*/*',
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          referer: options.referer || url
        },
        body: form,
        signal: AbortSignal.timeout(timeoutMs)
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return JSON.parse(text);
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(500 * attempt);
    }
  }
  throw lastError;
}

function qualityFields({ source, quoteDate, quoteTime, staleMaxDays = 5, historyOk = true, degraded = false }) {
  const normalizedDate = parseDateOnly(quoteDate || quoteTime);
  const stale = isStale(normalizedDate, staleMaxDays);
  return {
    source,
    quoteDate: normalizedDate,
    quoteTime: quoteTime || normalizedDate,
    ageDays: dateAgeDays(normalizedDate),
    stale,
    historyOk,
    dataQuality: stale ? 'stale' : degraded ? 'degraded' : 'ok'
  };
}

function buildQuoteFromCloses(item, rows, latestMeta = {}) {
  const closes = rows.map((row) => Number(row.close)).filter(Number.isFinite);
  const volumes = rows.map((row) => Number(row.volume)).filter(Number.isFinite);
  const price = Number.isFinite(latestMeta.price) ? latestMeta.price : closes.at(-1);
  const previousClose = Number.isFinite(latestMeta.previousClose) ? latestMeta.previousClose : closes.at(-2);
  const ma20 = avg(closes.slice(-20));
  const ma60 = avg(closes.slice(-60));
  const quoteDate = latestMeta.quoteDate || rows.at(-1)?.date;
  const quality = qualityFields({ ...latestMeta, quoteDate, historyOk: closes.length >= 61 });
  return {
    ...item,
    price,
    previousClose,
    changePct: pct(price, previousClose),
    return5d: closes.length > 6 ? pct(price, closes.at(-6)) : null,
    return20d: closes.length > 21 ? pct(price, closes.at(-21)) : null,
    return60d: closes.length > 61 ? pct(price, closes.at(-61)) : null,
    ma20,
    ma60,
    volume: volumes.at(-1) || latestMeta.volume || null,
    avgVolume20: avg(volumes.slice(-20)),
    trend: trendLabel(price, ma20, ma60),
    ok: Number.isFinite(price) && !quality.stale,
    ...quality
  };
}

async function fetchTencentA(item) {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${item.symbol},day,,,120,qfq`;
  const body = await httpJson(url);
  const node = body.data?.[item.symbol];
  const day = node?.day || node?.qfqday;
  if (!Array.isArray(day) || day.length < 2) throw new Error(`${item.symbol} no kline`);
  const rows = day.map((x) => ({
    date: x[0],
    open: Number(x[1]),
    close: Number(x[2]),
    high: Number(x[3]),
    low: Number(x[4]),
    volume: Number(x[5])
  }));
  return buildQuoteFromCloses(item, rows, { source: 'Tencent Finance A-share kline', staleMaxDays: 5 });
}

function parseTencentQuoteLine(line, item) {
  const match = line.match(/="([^"]*)"/);
  if (!match) throw new Error(`${item.symbol} quote parse failed`);
  const fields = match[1].split('~');
  const price = Number(fields[3]);
  const previousClose = Number(fields[4]);
  const changePct = Number(fields[32]);
  const return5d = Number(fields[59]);
  const return20d = Number(fields[60]);
  const return60d = Number(fields[61]);
  const quoteTime = fields[30] || null;
  const quality = qualityFields({
    source: 'Tencent Finance US quote',
    quoteTime,
    staleMaxDays: 5,
    historyOk: Number.isFinite(return20d),
    degraded: !Number.isFinite(return20d)
  });
  return {
    ...item,
    price,
    previousClose,
    changePct: Number.isFinite(changePct) ? changePct : pct(price, previousClose),
    return5d: Number.isFinite(return5d) ? return5d : null,
    return20d: Number.isFinite(return20d) ? return20d : null,
    return60d: Number.isFinite(return60d) ? return60d : null,
    ma20: null,
    ma60: null,
    volume: Number(fields[6]) || null,
    avgVolume20: null,
    high: Number(fields[33]),
    low: Number(fields[34]),
    trend: trendFromReturns(Number.isFinite(changePct) ? changePct : pct(price, previousClose), Number.isFinite(return20d) ? return20d : null),
    ok: Number.isFinite(price) && !quality.stale,
    ...quality
  };
}

async function fetchTencentQuotes(items) {
  const url = `https://qt.gtimg.cn/q=${items.map((x) => x.symbol).join(',')}`;
  const text = await httpText(url);
  const lines = text.split(';').map((x) => x.trim()).filter(Boolean);
  return items.map((item) => {
    const line = lines.find((x) => x.includes(`_${item.symbol}=`));
    if (!line) return failedQuote(item, 'quote missing');
    try {
      return parseTencentQuoteLine(line, item);
    } catch (err) {
      return failedQuote(item, err.message);
    }
  });
}

async function fetchCboeVix(item) {
  const text = await httpText('https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv', {
    accept: 'text/csv,*/*',
    timeoutMs: 15000
  });
  const lines = text.trim().split(/\r?\n/).slice(1).filter(Boolean);
  const rows = lines.map((line) => {
    const [date, open, high, low, close] = line.split(',');
    const [mm, dd, yyyy] = date.split('/');
    return {
      date: `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: null
    };
  });
  if (rows.length < 2) throw new Error('Cboe VIX no history');
  return buildQuoteFromCloses(item, rows, { source: 'Cboe VIX daily history', staleMaxDays: 5 });
}

async function fetchUsAndVix() {
  const usQuotes = await fetchTencentQuotes(TENCENT_US);
  const vixIndex = usQuotes.findIndex((q) => q.key === 'vix');
  if (vixIndex >= 0 && !usable(usQuotes[vixIndex])) {
    try {
      usQuotes[vixIndex] = await fetchCboeVix(TENCENT_US.find((q) => q.key === 'vix'));
    } catch (err) {
      usQuotes[vixIndex].fallbackErrors = [...(usQuotes[vixIndex].fallbackErrors || []), err.message];
    }
  }
  return usQuotes;
}

async function fetchBinanceCrypto(item) {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${item.binance}&interval=1d&limit=120`;
  const body = await httpJson(url);
  if (!Array.isArray(body) || body.length < 2) throw new Error('Binance no kline');
  const rows = body.map((x) => ({
    date: new Date(Number(x[0])).toISOString().slice(0, 10),
    open: Number(x[1]),
    high: Number(x[2]),
    low: Number(x[3]),
    close: Number(x[4]),
    volume: Number(x[5])
  }));
  return buildQuoteFromCloses(item, rows, { source: 'Binance Vision daily kline', staleMaxDays: 3 });
}

async function fetchGateCrypto(item) {
  const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${item.gate}&interval=1d&limit=120`;
  const body = await httpJson(url);
  if (!Array.isArray(body) || body.length < 2) throw new Error('Gate.io no kline');
  const rows = body
    .map((x) => ({
      date: new Date(Number(x[0]) * 1000).toISOString().slice(0, 10),
      close: Number(x[2]),
      high: Number(x[3]),
      low: Number(x[4]),
      open: Number(x[5]),
      volume: Number(x[6])
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return buildQuoteFromCloses(item, rows, { source: 'Gate.io daily kline', staleMaxDays: 3 });
}

async function fetchCoinGeckoCrypto(item) {
  const url = `https://api.coingecko.com/api/v3/coins/${item.coinId}/market_chart?vs_currency=usd&days=120&interval=daily`;
  const body = await httpJson(url);
  const rows = (body.prices || []).map(([ts, price]) => ({
    date: new Date(ts).toISOString().slice(0, 10),
    close: Number(price),
    volume: null
  }));
  if (rows.length < 2) throw new Error('CoinGecko no history');
  return buildQuoteFromCloses(item, rows, { source: 'CoinGecko market chart', staleMaxDays: 3 });
}

async function fetchCoinLoreCrypto(item) {
  const url = `https://api.coinlore.net/api/ticker/?id=${item.coinLoreId}`;
  const body = await httpJson(url);
  const node = Array.isArray(body) ? body[0] : null;
  if (!node) throw new Error('Coinlore no ticker');
  const price = Number(node.price_usd);
  const changePct = Number(node.percent_change_24h);
  const return5d = Number(node.percent_change_7d);
  const quality = qualityFields({
    source: 'Coinlore ticker fallback',
    quoteDate: new Date().toISOString().slice(0, 10),
    staleMaxDays: 1,
    historyOk: false,
    degraded: true
  });
  return {
    ...item,
    price,
    previousClose: Number.isFinite(changePct) ? price / (1 + changePct / 100) : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
    return5d: Number.isFinite(return5d) ? return5d : null,
    return20d: null,
    return60d: null,
    ma20: null,
    ma60: null,
    volume: null,
    avgVolume20: null,
    trend: trendFromReturns(changePct, return5d),
    ok: Number.isFinite(price) && !quality.stale,
    ...quality
  };
}

async function fetchCrypto(item) {
  const errors = [];
  for (const fn of [fetchBinanceCrypto, fetchGateCrypto, fetchCoinGeckoCrypto, fetchCoinLoreCrypto]) {
    try {
      const quote = await fn(item);
      return { ...quote, fallbackErrors: errors };
    } catch (err) {
      errors.push(err.message);
    }
  }
  return failedQuote(item, errors.join('; ') || 'all crypto sources failed');
}

async function fetchFxAndFutures() {
  const results = [];
  try {
    const fx = await httpJson('https://api.frankfurter.app/latest?from=USD&to=CNY');
    const price = Number(fx.rates?.CNY);
    const quality = qualityFields({
      source: 'Frankfurter FX daily',
      quoteDate: fx.date,
      staleMaxDays: 5,
      historyOk: false,
      degraded: true
    });
    results.push({
      key: 'usdcny',
      group: ZH.factor,
      name: ZH.usdcny,
      symbol: 'USD/CNY',
      price,
      previousClose: null,
      changePct: null,
      return5d: null,
      return20d: null,
      return60d: null,
      ma20: null,
      ma60: null,
      volume: null,
      avgVolume20: null,
      trend: ZH.dailyFx,
      ok: Number.isFinite(price) && !quality.stale,
      ...quality
    });
  } catch (err) {
    results.push(failedQuote({ key: 'usdcny', group: ZH.factor, name: ZH.usdcny, symbol: 'USD/CNY' }, err.message));
  }

  try {
    const text = await httpText('https://qt.gtimg.cn/q=hf_GC,hf_SI,hf_CL');
    const lines = text.split(';').map((x) => x.trim()).filter(Boolean);
    for (const [key, symbol, name] of [['oil', 'hf_CL', ZH.oil], ['gold', 'hf_GC', ZH.gold], ['silver', 'hf_SI', ZH.silver]]) {
      const line = lines.find((x) => x.includes(`_${symbol}=`));
      const match = line?.match(/="([^"]*)"/);
      if (!match) {
        results.push(failedQuote({ key, group: ZH.factor, name, symbol }, 'quote missing'));
        continue;
      }
      const fields = match[1].split(',');
      const price = Number(fields[0]);
      const change = Number(fields[1]);
      const previousClose = Number(fields[7]) || null;
      const quoteTime = `${fields[12] || ''} ${fields[6] || ''}`.trim();
      const quality = qualityFields({
        source: 'Tencent Finance futures quote',
        quoteTime,
        staleMaxDays: 3,
        historyOk: false,
        degraded: true
      });
      results.push({
        key,
        group: ZH.factor,
        name,
        symbol,
        price,
        previousClose,
        changePct: Number.isFinite(change) && Number.isFinite(previousClose) && previousClose !== 0 ? (change / previousClose) * 100 : null,
        return5d: null,
        return20d: null,
        return60d: null,
        ma20: null,
        ma60: null,
        volume: null,
        avgVolume20: null,
        trend: Number.isFinite(change) ? change >= 0 ? ZH.intradayStrong : ZH.intradayWeak : ZH.insufficient,
        ok: Number.isFinite(price) && !quality.stale,
        ...quality
      });
    }
  } catch (err) {
    results.push(failedQuote({ key: 'oil', group: ZH.factor, name: ZH.oil, symbol: 'hf_CL' }, err.message));
    results.push(failedQuote({ key: 'gold', group: ZH.factor, name: ZH.gold, symbol: 'hf_GC' }, err.message));
    results.push(failedQuote({ key: 'silver', group: ZH.factor, name: ZH.silver, symbol: 'hf_SI' }, err.message));
  }

  return results;
}

function parseFredCsv(text, series) {
  const rows = text.trim().split(/\r?\n/).slice(1)
    .map((line) => {
      const [date, raw] = line.split(',');
      const value = Number(raw);
      return Number.isFinite(value) ? { date, value } : null;
    })
    .filter(Boolean);
  if (rows.length < 2) throw new Error(`${series.id} no usable values`);
  const latest = rows.at(-1);
  const values = rows.map((x) => x.value);
  const quality = qualityFields({
    source: `FRED ${series.id}`,
    quoteDate: latest.date,
    staleMaxDays: series.staleMaxDays,
    historyOk: rows.length >= 21
  });
  return {
    ...series,
    value: latest.value,
    change5d: values.length > 6 ? latest.value - values.at(-6) : null,
    change20d: values.length > 21 ? latest.value - values.at(-21) : null,
    ...quality,
    ok: Number.isFinite(latest.value) && !quality.stale
  };
}

async function fetchFredSeries(series) {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series.id}`;
  return parseFredCsv(await httpText(url, { accept: 'text/csv,*/*', timeoutMs: 15000 }), series);
}

async function fetchMacroPricing() {
  const series = await Promise.all(FRED_SERIES.map((item) => safeFred(item)));
  const us10y = series.find((x) => x.key === 'us10y');
  const us2y = series.find((x) => x.key === 'us2y');
  const curve = us10y?.ok && us2y?.ok ? {
    key: 'yieldCurve',
    name: '10Y-2Y Treasury Curve',
    value: us10y.value - us2y.value,
    unit: 'pct_point',
    ok: true,
    source: 'FRED DGS10-DGS2',
    quoteDate: us10y.quoteDate,
    quoteTime: us10y.quoteDate,
    stale: false,
    dataQuality: 'ok',
    interpretation: us10y.value - us2y.value < 0 ? 'inverted' : 'normal'
  } : {
    key: 'yieldCurve',
    name: '10Y-2Y Treasury Curve',
    value: null,
    ok: false,
    source: null,
    quoteDate: null,
    stale: true,
    dataQuality: 'failed',
    interpretation: 'unavailable'
  };
  return { series, curve };
}

async function safeFred(series) {
  try {
    return await fetchFredSeries(series);
  } catch (err) {
    return {
      ...series,
      value: null,
      change5d: null,
      change20d: null,
      source: null,
      quoteDate: null,
      quoteTime: null,
      stale: true,
      dataQuality: 'failed',
      historyOk: false,
      ok: false,
      error: err.message
    };
  }
}

function failedQuote(item, error) {
  return {
    ...item,
    ok: false,
    price: null,
    previousClose: null,
    changePct: null,
    return5d: null,
    return20d: null,
    return60d: null,
    ma20: null,
    ma60: null,
    volume: null,
    avgVolume20: null,
    trend: ZH.abnormal,
    stale: true,
    historyOk: false,
    dataQuality: 'failed',
    quoteDate: null,
    quoteTime: null,
    source: null,
    error
  };
}

async function safe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    return failedQuote(label, err.message);
  }
}

async function fetchAll() {
  const [aQuotes, usQuotes, cryptoQuotes, factors] = await Promise.all([
    Promise.all(TENCENT_A.map((item) => safe(item, () => fetchTencentA(item)))),
    fetchUsAndVix(),
    Promise.all(CRYPTO.map((item) => safe(item, () => fetchCrypto(item)))),
    fetchFxAndFutures()
  ]);
  return [...aQuotes, ...usQuotes, ...cryptoQuotes, ...factors];
}

function byKey(quotes, key) {
  return quotes.find((q) => q.key === key) || {};
}

function safeNum(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function usable(q, { history = false } = {}) {
  return Boolean(q?.ok && !q.stale && Number.isFinite(q.price) && (!history || q.historyOk));
}

function buildQuality(quotes) {
  const aKeys = ['sse', 'szse', 'chinext'];
  const usKeys = ['nasdaq', 'qqq', 'spx'];
  const macroKeys = ['vix', 'usdcny'];
  const aOk = aKeys.filter((key) => usable(byKey(quotes, key), { history: true })).length;
  const usOk = usKeys.filter((key) => usable(byKey(quotes, key))).length;
  const macroOk = macroKeys.filter((key) => usable(byKey(quotes, key))).length;
  const stale = quotes.filter((q) => q.stale).map((q) => q.key);
  const failed = quotes.filter((q) => !q.ok).map((q) => q.key);
  return {
    aShare: { ok: aOk >= 2 && usable(byKey(quotes, 'sse'), { history: true }), passed: aOk, required: 2 },
    usStock: { ok: usOk >= 2 && usable(byKey(quotes, 'vix')), passed: usOk + (usable(byKey(quotes, 'vix')) ? 1 : 0), required: 4 },
    crypto: { ok: usable(byKey(quotes, 'btc'), { history: true }), passed: usable(byKey(quotes, 'btc'), { history: true }) ? 1 : 0, required: 1 },
    macro: { ok: macroOk >= 2, passed: macroOk, required: 2 },
    stale,
    failed,
    freshnessSummary: `OK ${quotes.filter((q) => q.ok && !q.stale).length}/${quotes.length}, stale ${stale.length}, failed ${failed.length}`
  };
}

function scoreMarket(quotes, quality) {
  const sse = byKey(quotes, 'sse');
  const szse = byKey(quotes, 'szse');
  const chinext = byKey(quotes, 'chinext');
  const spx = byKey(quotes, 'spx');
  const nasdaq = byKey(quotes, 'nasdaq');
  const qqq = byKey(quotes, 'qqq');
  const btc = byKey(quotes, 'btc');
  const vix = byKey(quotes, 'vix');
  const usdcny = byKey(quotes, 'usdcny');
  const gold = byKey(quotes, 'gold');
  const oil = byKey(quotes, 'oil');
  const vixForRisk = usable(vix) ? vix.price : 18;

  const aMomentum = quality.aShare.ok ? clamp(50
    + safeNum(sse.return20d) * 1.3
    + safeNum(szse.return20d) * 0.9
    + safeNum(chinext.return20d) * 0.7
    + (sse.price > sse.ma20 ? 6 : -4)
    + (sse.price > sse.ma60 ? 6 : -4)) : null;

  const usMomentum = quality.usStock.ok ? clamp(50
    + safeNum(nasdaq.return20d) * 1.2
    + safeNum(qqq.return20d) * 1.0
    + safeNum(spx.return20d) * 0.9
    + safeNum(nasdaq.changePct) * 2
    + safeNum(qqq.changePct) * 1.2
    - Math.max(0, safeNum(vixForRisk, 18) - 18) * 1.4) : null;

  const cryptoMomentum = quality.crypto.ok ? clamp(50
    + safeNum(btc.return20d) * 1.4
    + safeNum(btc.return5d) * 1.2
    + (btc.price > btc.ma20 ? 7 : -5)
    + (btc.price > btc.ma60 ? 7 : -5)
    - Math.max(0, safeNum(vixForRisk, 18) - 20)) : null;

  const dollarRatePressure = quality.macro.ok ? clamp(45
    + Math.max(0, safeNum(usdcny.price, 7) - 7) * 18
    + Math.max(0, safeNum(vix.price, 18) - 18) * 1.3
    + safeNum(gold.changePct) * 2
    + Math.max(0, safeNum(oil.changePct)) * 1.5) : null;

  const riskInputs = [aMomentum, usMomentum, cryptoMomentum].filter(Number.isFinite);
  const riskAppetite = riskInputs.length ? clamp(avg(riskInputs)) : null;

  return {
    riskAppetite,
    dollarRatePressure,
    aMomentum,
    usMomentum,
    cryptoMomentum
  };
}

function fmtSigned(value) {
  if (!Number.isFinite(value)) return ZH.insufficient;
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function fmtPlain(value) {
  if (!Number.isFinite(value)) return ZH.insufficient;
  return value.toFixed(value > 100 ? 0 : 2);
}

function cleanDisclosureTitle(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cninfoPdfUrl(adjunctUrl) {
  if (!adjunctUrl) return 'http://www.cninfo.com.cn/new/disclosure';
  if (/^https?:\/\//i.test(adjunctUrl)) return adjunctUrl;
  return `http://static.cninfo.com.cn/${String(adjunctUrl).replace(/^\/+/, '')}`;
}

function isCnHoldingChangeDisclosure(title) {
  const t = cleanDisclosureTitle(title);
  const relation = /[\u4eb2\u5c5e\u914d\u5076\u5b50\u5973\u7236\u6bcd\u5144\u5f1f\u59d0\u59b9]|\u8fd1\u4eb2\u5c5e/.test(t);
  const transaction = /\u77ed\u7ebf\u4ea4\u6613|\u7a97\u53e3\u671f|\u654f\u611f\u671f|\u8fdd\u89c4|\u8bef\u64cd\u4f5c|\u4e70\u5356|\u589e\u6301|\u51cf\u6301|\u6301\u80a1\u53d8\u52a8/.test(t);
  const governance = /\u8463\u4e8b|\u76d1\u4e8b|\u9ad8\u7ea7\u7ba1\u7406\u4eba\u5458|\u9ad8\u7ba1|\u8463\u76d1\u9ad8|\u5b9e\u9645\u63a7\u5236\u4eba|\u63a7\u80a1\u80a1\u4e1c/.test(t);
  const notPolicy = !/\u5236\u5ea6|\u529e\u6cd5|\u89c4\u5219|\u4fee\u8ba2|\u7ec6\u5219|\u4e8b\u524d\u62a5\u5907/.test(t);
  return relation && transaction && governance && notPolicy;
}

function cnDisclosureSignal(title) {
  if (/\u77ed\u7ebf\u4ea4\u6613|\u8fdd\u89c4|\u7a97\u53e3\u671f|\u654f\u611f\u671f|\u8bef\u64cd\u4f5c/.test(title)) {
    return '\u5408\u89c4\u98ce\u9669/\u6cbb\u7406\u7455\u75b5';
  }
  if (/\u589e\u6301/.test(title)) return '\u5185\u90e8\u4eba\u589e\u6301\u7ebf\u7d22';
  if (/\u51cf\u6301/.test(title)) return '\u5185\u90e8\u4eba\u51cf\u6301\u7ebf\u7d22';
  return '\u5173\u8054\u4eba\u4ea4\u6613\u7ebf\u7d22';
}

async function fetchCninfoRelatedAnnouncements() {
  const seen = new Set();
  const items = [];
  for (const query of CNINFO_DISCLOSURE_QUERIES) {
    const form = new URLSearchParams({
      pageNum: '1',
      pageSize: '20',
      column: 'szse',
      tabName: 'fulltext',
      plate: '',
      stock: '',
      searchkey: query,
      secid: '',
      category: '',
      trade: '',
      seDate: '',
      sortName: '',
      sortType: '',
      isHLtitle: 'true'
    });
    const body = await httpPostFormJson('http://www.cninfo.com.cn/new/hisAnnouncement/query', form, {
      referer: 'http://www.cninfo.com.cn/new/index'
    });
    for (const ann of body.announcements || []) {
      const id = ann.announcementId || `${ann.secCode}-${ann.announcementTime}-${ann.announcementTitle}`;
      const title = cleanDisclosureTitle(ann.announcementTitle);
      if (seen.has(id) || !isCnHoldingChangeDisclosure(title)) continue;
      seen.add(id);
      items.push({
        id,
        market: 'CN',
        date: ann.announcementTime ? new Date(Number(ann.announcementTime)).toISOString().slice(0, 10) : null,
        issuer: ann.secName || ann.orgName || '--',
        code: ann.secCode || '--',
        title,
        signal: cnDisclosureSignal(title),
        relationScope: '\u4e0a\u5e02\u516c\u53f8\u8463\u76d1\u9ad8/\u5b9e\u63a7\u4eba\u53ca\u8fd1\u4eb2\u5c5e\u516c\u5f00\u516c\u544a',
        source: 'CNINFO',
        url: cninfoPdfUrl(ann.adjunctUrl),
        query
      });
    }
    await sleep(150);
  }
  return items
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 10);
}

async function fetchPublicDisclosureSignals() {
  const updatedAt = new Date().toISOString();
  const legalBoundary = '\u4ec5\u7eb3\u5165\u5408\u6cd5\u516c\u5f00\u62ab\u9732\uff1b\u4e0d\u6293\u53d6\u6216\u63a8\u65ad\u672a\u516c\u5f00\u4e2a\u4eba\u8eab\u4efd\u3001\u4f4f\u5740\u3001\u8054\u7cfb\u65b9\u5f0f\u6216\u5bb6\u5ead\u9690\u79c1\u3002';
  let chinaItems = [];
  let chinaStatus = 'ok';
  let chinaError = null;
  try {
    chinaItems = await fetchCninfoRelatedAnnouncements();
    if (!chinaItems.length) chinaStatus = 'no_recent_filtered_items';
  } catch (err) {
    chinaStatus = 'source_unavailable';
    chinaError = err.message;
  }
  return {
    updatedAt,
    legalBoundary,
    privacyGuardrail: '\u914d\u5076/\u5b50\u5973/\u4eb2\u5c5e\u53ea\u6309\u516c\u544a\u539f\u6587\u7684\u5173\u7cfb\u8303\u56f4\u5448\u73b0\uff0c\u4e0d\u505a\u4eba\u8089\u8bc6\u522b\u6216\u989d\u5916\u8eab\u4efd\u62fc\u63a5\u3002',
    china: {
      status: chinaStatus,
      title: '\u4e2d\u56fd\uff1a\u4e0a\u5e02\u516c\u53f8\u516c\u544a\u62ab\u9732\u7684\u5173\u8054\u4eba\u6301\u80a1/\u4ea4\u6613\u53d8\u52a8',
      source: 'CNINFO official announcement search',
      sourceUrl: 'http://www.cninfo.com.cn/new/disclosure',
      legalBasis: '\u4e0a\u5e02\u516c\u53f8\u4fe1\u606f\u62ab\u9732\u3001\u8463\u76d1\u9ad8\u53ca\u8fd1\u4eb2\u5c5e\u4ea4\u6613\u76f8\u5173\u516c\u544a',
      items: chinaItems,
      error: chinaError
    },
    us: {
      status: 'official_portal_links_only',
      title: 'US: STOCK Act / financial disclosure portals',
      legalBasis: 'Public financial disclosure and periodic transaction reports where published by official portals',
      note: 'Official House and Senate portals expose legally disclosed reports, but they are not a stable unauthenticated JSON feed. The board links official sources and avoids copying unofficial or blocked datasets.',
      sources: US_OFFICIAL_DISCLOSURE_SOURCES,
      items: []
    },
    tradeUse: [
      '\u628a\u5b98\u5458/\u5173\u8054\u4eba\u516c\u5f00\u6301\u4ed3\u53d8\u52a8\u5f53\u4f5c\u653f\u7b56\u654f\u611f\u884c\u4e1a\u3001\u5408\u89c4\u98ce\u9669\u548c\u4e8b\u4ef6\u50ac\u5316\u7ebf\u7d22\uff0c\u4e0d\u5355\u72ec\u4f5c\u4e3a\u4e70\u5356\u6307\u4ee4\u3002',
      '\u4e0e\u884c\u4e1a\u653f\u7b56\u3001\u8ba2\u5355/\u8d22\u62a5\u3001\u4f30\u503c\u5206\u4f4d\u3001\u6210\u4ea4\u91cf\u7a81\u7834\u4ea4\u53c9\u9a8c\u8bc1\u3002',
      '\u51fa\u73b0\u7a97\u53e3\u671f/\u77ed\u7ebf\u4ea4\u6613\u7c7b\u516c\u544a\u65f6\uff0c\u5148\u964d\u4f4e\u6cbb\u7406\u8d28\u91cf\u8bc4\u5206\uff0c\u518d\u68c0\u67e5\u662f\u4e2a\u4f8b\u8fd8\u662f\u6301\u7eed\u98ce\u9669\u3002'
    ]
  };
}

function actionFromScore(score) {
  if (!Number.isFinite(score)) return ZH.pause;
  if (score >= 66) return ZH.add;
  if (score >= 53) return ZH.hold;
  if (score >= 42) return ZH.watch;
  return ZH.reduce;
}

function pauseRecommendation(reason, evidence = []) {
  return {
    action: ZH.pause,
    confidence: 0,
    advice: reason,
    reasons: evidence,
    invalidations: [
      '\u5173\u952e\u6570\u636e\u6e90\u6062\u590d\u4e14\u901a\u8fc7\u65b0\u9c9c\u5ea6\u68c0\u67e5',
      '\u4ef7\u683c\u3001\u6ce2\u52a8\u7387\u548c\u8de8\u8d44\u4ea7\u4fe1\u53f7\u91cd\u65b0\u5f62\u6210\u5171\u632f'
    ]
  };
}

function buildRecommendations(quotes, scores, quality) {
  const sse = byKey(quotes, 'sse');
  const nasdaq = byKey(quotes, 'nasdaq');
  const qqq = byKey(quotes, 'qqq');
  const btc = byKey(quotes, 'btc');
  const vix = byKey(quotes, 'vix');
  const usdcny = byKey(quotes, 'usdcny');
  const vixText = usable(vix) ? `VIX \u5f53\u524d ${fmtPlain(vix.price)}` : 'VIX \u6570\u636e\u672a\u901a\u8fc7\u8d28\u91cf\u68c0\u67e5';

  const aScore = quality.aShare.ok ? clamp(scores.aMomentum - Math.max(0, safeNum(scores.dollarRatePressure, 50) - 55) * 0.4) : null;
  const usScore = quality.usStock.ok ? clamp(scores.usMomentum - Math.max(0, safeNum(vix.price, 18) - 22) * 2) : null;
  const btcScore = quality.crypto.ok ? clamp(scores.cryptoMomentum - Math.max(0, safeNum(scores.dollarRatePressure, 50) - 58) * 0.5) : null;

  const aAction = actionFromScore(aScore);
  const usAction = actionFromScore(usScore);
  const btcAction = actionFromScore(btcScore);

  return {
    aShare: quality.aShare.ok ? {
      action: aAction,
      confidence: Math.round(aScore),
      advice: aAction === ZH.add
        ? 'A \u80a1\u8d8b\u52bf\u548c\u4eba\u6c11\u5e01\u73af\u5883\u76f8\u5bf9\u914d\u5408\uff0c\u53ef\u63d0\u9ad8\u7ed3\u6784\u6027\u4ed3\u4f4d\uff0c\u4f18\u5148\u9009\u62e9\u5f3a\u8d8b\u52bf\u3001\u771f\u4e1a\u7ee9\u548c\u653f\u7b56\u4e3b\u7ebf\u3002'
        : aAction === ZH.reduce
          ? 'A \u80a1\u98ce\u9669\u504f\u597d\u504f\u5f31\uff0c\u4f18\u5148\u964d\u4f4e\u9ad8\u5f39\u6027\u9898\u6750\u548c\u4e8f\u635f\u80a1\uff0c\u4fdd\u7559\u7ea2\u5229\u3001\u73b0\u91d1\u6d41\u548c\u5f3a\u57fa\u672c\u9762\u4ed3\u4f4d\u3002'
          : '\u7ef4\u6301\u89c2\u5bdf\u6216\u7ed3\u6784\u6027\u6301\u4ed3\u3002\u53ea\u5728\u884c\u4e1a\u5f3a\u5ea6\u3001\u6210\u4ea4\u989d\u548c\u4eba\u6c11\u5e01\u7a33\u5b9a\u5171\u632f\u65f6\u63d0\u9ad8\u4ed3\u4f4d\u3002',
      reasons: [
        `\u4e0a\u8bc1 20 \u65e5\u8868\u73b0 ${fmtSigned(sse.return20d)}\uff0c\u8d8b\u52bf\u72b6\u6001\uff1a${sse.trend}\uff0c\u884c\u60c5\u65e5\u671f\uff1a${sse.quoteDate}`,
        `USD/CNY \u5f53\u524d ${fmtPlain(usdcny.price)}\uff0c\u7528\u4e8e\u5ba1\u67e5\u4eba\u6c11\u5e01\u538b\u529b`,
        `A \u80a1\u52a8\u91cf\u8bc4\u5206 ${Math.round(scores.aMomentum)}/100`
      ],
      invalidations: [
        '\u4eba\u6c11\u5e01\u5feb\u901f\u8d2c\u503c\u4e14\u6e2f\u80a1/\u4e2d\u56fd\u8d44\u4ea7\u540c\u6b65\u8d70\u5f31',
        'A \u80a1\u6307\u6570\u8dcc\u7834 20/60 \u65e5\u5747\u7ebf\u4e14\u6210\u4ea4\u989d\u653e\u5927\u4e0b\u8dcc',
        '\u653f\u7b56\u9884\u671f\u5151\u73b0\u540e\u9898\u6750\u9ad8\u4f4d\u653e\u91cf\u6ede\u6da8'
      ]
    } : pauseRecommendation('A \u80a1\u5173\u952e\u6570\u636e\u672a\u901a\u8fc7\u8d28\u91cf\u95f8\u95e8\uff0c\u6682\u505c\u751f\u6210\u65b9\u5411\u6027\u4ed3\u4f4d\u5efa\u8bae\u3002', [
      `\u901a\u8fc7 ${quality.aShare.passed}/${quality.aShare.required} \u9879 A \u80a1\u6570\u636e\u68c0\u67e5`,
      `\u5931\u8d25\u6570\u636e\uff1a${quality.failed.join(', ') || '\u65e0'}`
    ]),
    usStock: quality.usStock.ok ? {
      action: usAction,
      confidence: Math.round(usScore),
      advice: usAction === ZH.add
        ? '\u7f8e\u80a1\u98ce\u9669\u504f\u597d\u8f83\u5f3a\uff0c\u53ef\u6301\u6709\u6216\u5c0f\u5e45\u63d0\u9ad8\u4f18\u8d28\u79d1\u6280/\u6307\u6570\u4ed3\u4f4d\uff0c\u4ecd\u9700\u63a7\u5236\u4f30\u503c\u548c\u6ce2\u52a8\u7387\u51b2\u51fb\u3002'
        : usAction === ZH.reduce
          ? '\u7f8e\u80a1\u627f\u538b\uff0c\u4f18\u5148\u964d\u4f4e\u9ad8\u4f30\u503c\u957f\u4e45\u671f\u8d44\u4ea7\uff0c\u7b49\u5f85\u6ce2\u52a8\u7387\u538b\u529b\u7f13\u548c\u3002'
          : '\u7f8e\u80a1\u7ef4\u6301\u6301\u6709\u6216\u89c2\u671b\uff0cAI \u4e3b\u7ebf\u53ef\u7ee7\u7eed\u8ddf\u8e2a\uff0c\u4f46\u4e0d\u8ffd\u9ad8\u4f4e\u8d54\u7387\u4f4d\u7f6e\u3002',
      reasons: [
        `\u7eb3\u65af\u8fbe\u514b 20 \u65e5\u8868\u73b0 ${fmtSigned(nasdaq.return20d)}\uff0cQQQ 20 \u65e5\u8868\u73b0 ${fmtSigned(qqq.return20d)}`,
        `${vixText}\uff0c\u884c\u60c5\u65f6\u95f4\uff1a${vix.quoteTime || vix.quoteDate || '\u65e0'}`,
        `\u7f8e\u80a1\u52a8\u91cf\u8bc4\u5206 ${Math.round(scores.usMomentum)}/100`
      ],
      invalidations: [
        'VIX \u5347\u7834 25 \u4e14\u6807\u666e\u8dcc\u7834\u5173\u952e\u5747\u7ebf',
        'AI \u8d44\u672c\u5f00\u652f\u6216\u9f99\u5934\u8d22\u62a5\u4f4e\u4e8e\u9884\u671f',
        '\u7f8e\u5143/\u5229\u7387\u538b\u529b\u91cd\u65b0\u62ac\u5347\u5e76\u538b\u5236\u4f30\u503c'
      ]
    } : pauseRecommendation('\u7f8e\u80a1\u5173\u952e\u6570\u636e\u672a\u901a\u8fc7\u8d28\u91cf\u95f8\u95e8\uff0c\u6682\u505c\u751f\u6210\u65b9\u5411\u6027\u4ed3\u4f4d\u5efa\u8bae\u3002', [
      `\u901a\u8fc7 ${quality.usStock.passed}/${quality.usStock.required} \u9879\u7f8e\u80a1/VIX \u6570\u636e\u68c0\u67e5`,
      `\u5931\u8d25\u6570\u636e\uff1a${quality.failed.join(', ') || '\u65e0'}`
    ]),
    btc: quality.crypto.ok ? {
      action: btcAction,
      confidence: Math.round(btcScore),
      advice: btcAction === ZH.add
        ? 'BTC \u8d8b\u52bf\u4e0e\u98ce\u9669\u504f\u597d\u5171\u632f\uff0c\u53ef\u5728\u65e2\u5b9a\u4ed3\u4f4d\u4e0a\u9650\u5185\u5206\u6279\u52a0\u4ed3\uff0c\u5fc5\u987b\u8bbe\u7f6e\u56de\u64a4\u548c\u6760\u6746\u98ce\u9669\u9608\u503c\u3002'
        : btcAction === ZH.reduce
          ? 'BTC \u9762\u4e34\u98ce\u9669\u504f\u597d\u6216\u7f8e\u5143\u538b\u529b\uff0c\u964d\u4f4e\u9ad8\u6ce2\u52a8\u4ed3\u4f4d\uff0c\u907f\u514d\u6760\u6746\u548c\u8ffd\u6da8\u3002'
          : 'BTC \u7ef4\u6301\u89c2\u5bdf\u6216\u8f7b\u4ed3\u6301\u6709\u3002\u7b49\u5f85\u4ef7\u683c\u8d8b\u52bf\u3001\u7f8e\u5143\u8d70\u5f31\u548c\u8d44\u91d1\u6d41\u5171\u632f\u3002',
      reasons: [
        `BTC 20 \u65e5\u8868\u73b0 ${fmtSigned(btc.return20d)}\uff0c\u8d8b\u52bf\u72b6\u6001\uff1a${btc.trend}\uff0c\u6570\u636e\u6e90\uff1a${btc.source}`,
        `${vixText}\uff0c\u7528\u4e8e\u5ba1\u67e5\u98ce\u9669\u504f\u597d`,
        `\u52a0\u5bc6\u52a8\u91cf\u8bc4\u5206 ${Math.round(scores.cryptoMomentum)}/100`
      ],
      invalidations: [
        'BTC \u8dcc\u7834 20/60 \u65e5\u5747\u7ebf\u4e14\u653e\u91cf\u4e0b\u884c',
        'VIX \u5feb\u901f\u4e0a\u884c\u5bfc\u81f4\u98ce\u9669\u8d44\u4ea7\u540c\u6b65\u56de\u64a4',
        'ETF \u8d44\u91d1\u6301\u7eed\u6d41\u51fa\u6216\u5408\u7ea6\u6760\u6746\u6e05\u7b97\u98ce\u9669\u5347\u6e29'
      ]
    } : pauseRecommendation('BTC \u5386\u53f2\u4ef7\u683c\u6570\u636e\u672a\u901a\u8fc7\u8d28\u91cf\u95f8\u95e8\uff0c\u6682\u4e0d\u751f\u6210\u65b9\u5411\u6027\u4fe1\u53f7\u3002', [
      `BTC \u6570\u636e\u6e90\uff1a${btc.source || '\u5168\u90e8\u5931\u8d25'}`,
      `\u72b6\u6001\uff1a${btc.error || btc.dataQuality || ZH.insufficient}`
    ])
  };
}

function buildPulse(quotes, scores, quality) {
  const vix = byKey(quotes, 'vix');
  const usdcny = byKey(quotes, 'usdcny');
  const oil = byKey(quotes, 'oil');
  const gold = byKey(quotes, 'gold');
  const riskInputs = [
    quality.aShare.ok ? 'A \u80a1' : null,
    quality.usStock.ok ? '\u7f8e\u80a1' : null,
    quality.crypto.ok ? 'BTC' : null
  ].filter(Boolean).join(' / ');
  return [
    {
      name: '\u98ce\u9669\u504f\u597d',
      score: Math.round(safeNum(scores.riskAppetite, 0)),
      comment: `\u7531 ${riskInputs || '\u6682\u65e0\u8db3\u591f\u6570\u636e'} \u5408\u6210\u3002${usable(vix) ? `VIX \u5f53\u524d ${fmtPlain(vix.price)}` : 'VIX \u672a\u901a\u8fc7\u8d28\u91cf\u68c0\u67e5'}\u3002`
    },
    {
      name: '\u4eba\u6c11\u5e01\u7a33\u5b9a',
      score: Math.round(clamp(70 - Math.max(0, safeNum(usdcny.price, 7) - 7) * 18) ?? 0),
      comment: `USD/CNY \u5f53\u524d ${fmtPlain(usdcny.price)}\uff0c\u4e0a\u884c\u4ee3\u8868\u4eba\u6c11\u5e01\u5151\u7f8e\u5143\u8d70\u5f31\u3002`
    },
    {
      name: '\u5546\u54c1\u538b\u529b',
      score: Math.round(clamp(50 + safeNum(oil.changePct) * 4 + safeNum(gold.changePct) * 2) ?? 0),
      comment: `\u539f\u6cb9\u65e5\u6da8\u8dcc ${fmtSigned(oil.changePct)}\uff0c\u9ec4\u91d1\u65e5\u6da8\u8dcc ${fmtSigned(gold.changePct)}\u3002`
    },
    {
      name: '\u6570\u636e\u8d28\u91cf',
      score: Math.round((quotes.filter((q) => q.ok && !q.stale).length / quotes.length) * 100),
      comment: quality.freshnessSummary
    }
  ];
}

function scoreFromChange(change, direction = 'up_good', scale = 8) {
  if (!Number.isFinite(change)) return null;
  const raw = direction === 'up_good' ? 50 + change * scale : 50 - change * scale;
  return clamp(raw);
}

function latestMacro(macroPricing, key) {
  return macroPricing.series.find((x) => x.key === key) || {};
}

function buildNowcast(quotes, macroPricing) {
  const sse = byKey(quotes, 'sse');
  const chinext = byKey(quotes, 'chinext');
  const oil = byKey(quotes, 'oil');
  const gold = byKey(quotes, 'gold');
  const silver = byKey(quotes, 'silver');
  const usdcny = byKey(quotes, 'usdcny');
  const breakeven = latestMacro(macroPricing, 'breakeven10y');
  const hySpread = latestMacro(macroPricing, 'hySpread');
  const nfci = latestMacro(macroPricing, 'nfci');

  const chinaGrowth = clamp(50 + safeNum(sse.return20d) * 1.4 + safeNum(chinext.return20d) * 0.8 - Math.max(0, safeNum(usdcny.price, 7) - 7) * 10);
  const inflationPressure = clamp(50 + safeNum(oil.changePct) * 4 + safeNum(breakeven.change5d) * 35 + safeNum(gold.changePct) * 1.5);
  const globalLiquidity = clamp(50 - safeNum(hySpread.change20d) * 8 - safeNum(nfci.change20d) * 40);
  const preciousSignal = clamp(50 + safeNum(gold.changePct) * 3 + safeNum(silver.changePct) * 2);

  return [
    {
      key: 'china_growth',
      name: '\u4e2d\u56fd\u589e\u957f\u5373\u65f6\u611f\u77e5',
      score: Math.round(chinaGrowth ?? 0),
      direction: chinaGrowth >= 55 ? '\u6539\u5584' : chinaGrowth <= 45 ? '\u8d70\u5f31' : '\u4e2d\u6027',
      evidence: [`\u4e0a\u8bc1 20\u65e5 ${fmtSigned(sse.return20d)}`, `\u521b\u4e1a\u677f 20\u65e5 ${fmtSigned(chinext.return20d)}`, `USD/CNY ${fmtPlain(usdcny.price)}`],
      tradeUse: '\u7528\u4e8e\u5224\u65ad A \u80a1\u653f\u7b56\u9884\u671f\u662f\u5426\u88ab\u8fc7\u5ea6\u5b9a\u4ef7\u3002'
    },
    {
      key: 'inflation_nowcast',
      name: '\u901a\u80c0\u538b\u529b Nowcast',
      score: Math.round(inflationPressure ?? 0),
      direction: inflationPressure >= 55 ? '\u5347\u6e29' : inflationPressure <= 45 ? '\u964d\u6e29' : '\u4e2d\u6027',
      evidence: [`\u539f\u6cb9\u65e5\u53d8\u52a8 ${fmtSigned(oil.changePct)}`, `10Y\u901a\u80c0\u76c8\u4e8f\u5e73\u88615\u65e5 ${fmtSigned(breakeven.change5d)}`, `\u9ec4\u91d1\u65e5\u53d8\u52a8 ${fmtSigned(gold.changePct)}`],
      tradeUse: '\u7528\u4e8e\u5224\u65ad CPI \u524d\u7684\u9ec4\u91d1\u3001\u7f8e\u503a\u548c\u957f\u4e45\u671f\u80a1\u7968\u98ce\u9669\u3002'
    },
    {
      key: 'liquidity_nowcast',
      name: '\u6d41\u52a8\u6027/\u4fe1\u7528\u8109\u51b2',
      score: Math.round(globalLiquidity ?? 0),
      direction: globalLiquidity >= 55 ? '\u5bbd\u677e' : globalLiquidity <= 45 ? '\u6536\u7d27' : '\u4e2d\u6027',
      evidence: [`\u9ad8\u6536\u76ca\u5229\u5dee20\u65e5 ${fmtSigned(hySpread.change20d)}`, `NFCI 20\u65e5 ${fmtSigned(nfci.change20d)}`],
      tradeUse: '\u7528\u4e8e\u5224\u65ad\u98ce\u9669\u8d44\u4ea7\u662f\u5426\u5904\u4e8e\u201c\u6d41\u52a8\u6027\u987a\u98ce\u201d\u3002'
    },
    {
      key: 'safe_haven',
      name: '\u907f\u9669\u5fae\u89c2\u75d5\u8ff9',
      score: Math.round(preciousSignal ?? 0),
      direction: preciousSignal >= 55 ? '\u907f\u9669\u5347\u6e29' : preciousSignal <= 45 ? '\u907f\u9669\u964d\u6e29' : '\u4e2d\u6027',
      evidence: [`\u9ec4\u91d1 ${fmtSigned(gold.changePct)}`, `\u767d\u94f6 ${fmtSigned(silver.changePct)}`],
      tradeUse: '\u65e0\u660e\u786e\u65b0\u95fb\u65f6\u7684\u8d35\u91d1\u5c5e\u5f02\u52a8\uff0c\u53ef\u4f5c\u4e3a\u5730\u7f18/\u901a\u80c0\u9884\u671f\u75d5\u8ff9\u3002'
    }
  ];
}

function buildImpliedPricing(quotes, macroPricing) {
  const vix = byKey(quotes, 'vix');
  const qqq = byKey(quotes, 'qqq');
  const btc = byKey(quotes, 'btc');
  const us10y = latestMacro(macroPricing, 'us10y');
  const breakeven = latestMacro(macroPricing, 'breakeven10y');
  const hySpread = latestMacro(macroPricing, 'hySpread');
  const curve = macroPricing.curve;

  return [
    {
      key: 'rates',
      name: '\u5229\u7387\u9690\u542b\u5b9a\u4ef7',
      value: `${fmtPlain(us10y.value)}%`,
      change: `5\u65e5 ${fmtSigned(us10y.change5d)}`,
      read: safeNum(us10y.change5d) > 0.08 ? '\u5229\u7387\u4e0a\u884c\u538b\u5236\u957f\u4e45\u671f\u8d44\u4ea7' : safeNum(us10y.change5d) < -0.08 ? '\u5229\u7387\u4e0b\u884c\u652f\u6491\u4f30\u503c' : '\u5229\u7387\u9884\u671f\u6682\u65f6\u7a33\u5b9a',
      source: us10y.source,
      quoteDate: us10y.quoteDate
    },
    {
      key: 'inflation_expectation',
      name: '\u901a\u80c0\u76c8\u4e8f\u5e73\u8861',
      value: `${fmtPlain(breakeven.value)}%`,
      change: `5\u65e5 ${fmtSigned(breakeven.change5d)}`,
      read: safeNum(breakeven.change5d) > 0.05 ? '\u5e02\u573a\u63d0\u524d\u4ea4\u6613\u901a\u80c0\u8d85\u9884\u671f' : safeNum(breakeven.change5d) < -0.05 ? '\u901a\u80c0\u9884\u671f\u964d\u6e29' : '\u901a\u80c0\u9884\u671f\u7a33\u5b9a',
      source: breakeven.source,
      quoteDate: breakeven.quoteDate
    },
    {
      key: 'credit',
      name: '\u4fe1\u7528\u98ce\u9669\u5b9a\u4ef7',
      value: `${fmtPlain(hySpread.value)}%`,
      change: `20\u65e5 ${fmtSigned(hySpread.change20d)}`,
      read: safeNum(hySpread.change20d) > 0.15 ? '\u4fe1\u7528\u5229\u5dee\u6269\u5927\uff0c\u98ce\u9669\u8d44\u4ea7\u627f\u538b' : safeNum(hySpread.change20d) < -0.15 ? '\u4fe1\u7528\u4fee\u590d\uff0c\u98ce\u9669\u504f\u597d\u6709\u652f\u6491' : '\u4fe1\u7528\u5b9a\u4ef7\u6682\u65f6\u7a33\u5b9a',
      source: hySpread.source,
      quoteDate: hySpread.quoteDate
    },
    {
      key: 'risk_crowding',
      name: '\u98ce\u9669\u62e5\u6324/\u8106\u5f31\u5ea6',
      value: `VIX ${fmtPlain(vix.price)} / QQQ20 ${fmtSigned(qqq.return20d)} / BTC20 ${fmtSigned(btc.return20d)}`,
      change: `10Y-2Y ${fmtPlain(curve.value)}%`,
      read: safeNum(vix.price) < 17 && safeNum(qqq.return20d) > 5 ? '\u4f4e\u6ce2\u52a8+\u9ad8\u6da8\u5e45\uff0c\u8b66\u60d5\u201c\u53ea\u8981\u4e0d\u6781\u597d\u5c31\u662f\u574f\u201d' : safeNum(vix.price) > 25 ? '\u6050\u614c\u5b9a\u4ef7\u5df2\u7ecf\u663e\u6027\u5316\uff0c\u53cd\u800c\u8981\u627e\u9884\u671f\u5dee' : '\u98ce\u9669\u5b9a\u4ef7\u672a\u8fbe\u6781\u7aef',
      source: 'Cboe/Tencent/Binance/FRED',
      quoteDate: vix.quoteDate
    }
  ];
}

function buildMarketTraces(quotes, macroPricing) {
  const gold = byKey(quotes, 'gold');
  const silver = byKey(quotes, 'silver');
  const oil = byKey(quotes, 'oil');
  const btc = byKey(quotes, 'btc');
  const eth = byKey(quotes, 'eth');
  const vix = byKey(quotes, 'vix');
  const hySpread = latestMacro(macroPricing, 'hySpread');
  return [
    {
      key: 'gold_silver',
      name: '\u9ec4\u91d1/\u767d\u94f6\u5f02\u52a8',
      signal: safeNum(gold.changePct) > 0.5 && safeNum(silver.changePct) < safeNum(gold.changePct) ? '\u907f\u9669\u504f\u5f3a' : '\u672a\u89c1\u660e\u663e\u907f\u9669\u80cc\u79bb',
      evidence: [`\u9ec4\u91d1 ${fmtSigned(gold.changePct)}`, `\u767d\u94f6 ${fmtSigned(silver.changePct)}`],
      action: '\u82e5\u65e0\u65b0\u95fb\u89e3\u91ca\u5374\u6301\u7eed\u62c9\u5347\uff0c\u68c0\u67e5\u901a\u80c0\u9884\u671f\u548c\u5730\u7f18\u4e8b\u4ef6\u3002'
    },
    {
      key: 'oil_inflation',
      name: '\u539f\u6cb9\u5bf9 CPI \u7684\u524d\u7f6e\u538b\u529b',
      signal: safeNum(oil.changePct) > 1 ? '\u901a\u80c0\u518d\u5b9a\u4ef7\u98ce\u9669' : safeNum(oil.changePct) < -1 ? '\u901a\u80c0\u964d\u6e29\u7ebf\u7d22' : '\u539f\u6cb9\u5bf9\u5f53\u65e5\u901a\u80c0\u4fe1\u53f7\u4e2d\u6027',
      evidence: [`WTI ${fmtSigned(oil.changePct)}`],
      action: '\u5728 CPI/PPI \u524d\uff0c\u7528\u539f\u6cb9+\u901a\u80c0\u76c8\u4e8f\u5e73\u8861\u5224\u65ad\u5e02\u573a\u662f\u5426\u5df2\u62a2\u8dd1\u3002'
    },
    {
      key: 'crypto_beta',
      name: 'BTC/ETH \u98ce\u9669\u5f39\u6027',
      signal: safeNum(btc.return20d) > safeNum(eth.return20d) ? 'BTC \u76f8\u5bf9\u6297\u8dcc/\u5438\u91d1' : 'ETH \u6216\u5c71\u5be8\u98ce\u9669\u504f\u597d\u66f4\u5f3a',
      evidence: [`BTC20 ${fmtSigned(btc.return20d)}`, `ETH20 ${fmtSigned(eth.return20d)}`],
      action: '\u82e5\u7f8e\u80a1\u4e0e\u52a0\u5bc6\u540c\u5411\u8d70\u5f31\uff0c\u907f\u514d\u6760\u6746\uff1b\u82e5\u80cc\u79bb\uff0c\u67e5\u627e ETF/\u76d1\u7ba1/\u6d41\u52a8\u6027\u50ac\u5316\u3002'
    },
    {
      key: 'credit_vol',
      name: '\u4fe1\u7528\u5229\u5dee + VIX',
      signal: safeNum(hySpread.change20d) > 0.15 && safeNum(vix.price) > 20 ? '\u98ce\u9669\u6536\u7f29\u5171\u632f' : '\u672a\u5f62\u6210\u4fe1\u7528-\u6ce2\u52a8\u5171\u632f\u538b\u529b',
      evidence: [`HY OAS 20\u65e5 ${fmtSigned(hySpread.change20d)}`, `VIX ${fmtPlain(vix.price)}`],
      action: '\u4fe1\u7528\u548c\u6ce2\u52a8\u540c\u65f6\u8d70\u5f31\u65f6\uff0c\u964d\u4f4e\u9ad8 beta \u548c\u957f\u4e45\u671f\u8d44\u4ea7\u3002'
    }
  ];
}

function buildLeadLagChain(quotes, macroPricing) {
  const sse = byKey(quotes, 'sse');
  const usdcny = byKey(quotes, 'usdcny');
  const hySpread = latestMacro(macroPricing, 'hySpread');
  const nfci = latestMacro(macroPricing, 'nfci');
  const breakeven = latestMacro(macroPricing, 'breakeven10y');
  return [
    { stage: '\u4fe1\u7528/\u6d41\u52a8\u6027', horizon: '\u9886\u5148 6-9 \u4e2a\u6708', state: safeNum(hySpread.change20d) < 0 && safeNum(nfci.change20d) < 0 ? '\u6539\u5584' : '\u9700\u8b66\u60d5', evidence: [`HY OAS20 ${fmtSigned(hySpread.change20d)}`, `NFCI20 ${fmtSigned(nfci.change20d)}`] },
    { stage: '\u80a1\u5e02\u4f30\u503c/\u98ce\u9669\u504f\u597d', horizon: '\u9886\u5148 3-6 \u4e2a\u6708', state: safeNum(sse.return20d) > 0 ? '\u4fee\u590d' : '\u504f\u5f31', evidence: [`\u4e0a\u8bc120 ${fmtSigned(sse.return20d)}`, `USD/CNY ${fmtPlain(usdcny.price)}`] },
    { stage: 'PMI/\u4f01\u4e1a\u5229\u6da6', horizon: '\u9886\u5148 1-3 \u4e2a\u6708', state: '\u9700\u63a5\u5165 PMI/\u9ad8\u9891\u5efa\u6750\u6570\u636e', evidence: ['\u5f85\u63a5\u5165\uff1aPMI\u9884\u671f\u3001\u87ba\u7eb9\u94a2\u8868\u9700\u3001\u6c34\u6ce5\u5e93\u5bb9\u6bd4'] },
    { stage: '\u5c31\u4e1a/\u901a\u80c0', horizon: '\u6ede\u540e\u6307\u6807', state: safeNum(breakeven.change5d) > 0.05 ? '\u901a\u80c0\u9884\u671f\u5347\u6e29' : '\u901a\u80c0\u9884\u671f\u5e73\u7a33', evidence: [`10Y BEI5 ${fmtSigned(breakeven.change5d)}`] }
  ];
}

function buildPlaybook(recommendations, nowcast, impliedPricing, marketTraces) {
  const inflation = nowcast.find((x) => x.key === 'inflation_nowcast');
  const liquidity = nowcast.find((x) => x.key === 'liquidity_nowcast');
  const rates = impliedPricing.find((x) => x.key === 'rates');
  return [
    {
      market: 'A \u80a1',
      setup: '\u653f\u7b56\u9884\u671f\u5dee + \u4eba\u6c11\u5e01\u7a33\u5b9a + \u6307\u6570\u4e0d\u518d\u7834\u4f4d',
      action: recommendations.aShare.action,
      operation: recommendations.aShare.action === ZH.reduce ? '\u964d\u4f4e\u9ad8\u5f39\u6027\u9898\u6750\uff0c\u53ea\u7559\u5f3a\u57fa\u672c\u9762/\u7ea2\u5229/\u653f\u7b56\u4e3b\u7ebf\u3002' : '\u7b49\u5f85\u9884\u671f\u5dee\u4e0e\u653e\u91cf\u7a81\u7834\u5171\u632f\u518d\u52a0\u4ed3\u3002',
      confirm: ['\u4e0a\u8bc1\u7ad9\u56de 20/60 \u65e5\u5747\u7ebf', '\u4eba\u6c11\u5e01\u4e0d\u518d\u8d70\u5f31', '\u4fe1\u7528/\u6d41\u52a8\u6027\u6307\u6807\u6539\u5584'],
      stop: recommendations.aShare.invalidations
    },
    {
      market: '\u7f8e\u80a1',
      setup: '\u5229\u7387\u9690\u542b\u5b9a\u4ef7 + VIX + \u4fe1\u7528\u5229\u5dee',
      action: recommendations.usStock.action,
      operation: rates?.read.includes('\u4e0a\u884c') || recommendations.usStock.action === ZH.reduce ? '\u964d\u4f4e\u9ad8\u4f30\u503c\u957f\u4e45\u671f\u4ed3\u4f4d\uff0c\u7b49\u5f85\u5229\u7387\u6216\u8d22\u62a5\u9884\u671f\u5dee\u4fee\u590d\u3002' : '\u6301\u6709\u6307\u6570\u6838\u5fc3\u4ed3\uff0c\u4e0d\u8ffd\u9ad8\u4f4e\u8d54\u7387\u4f4d\u7f6e\u3002',
      confirm: ['VIX \u4f4e\u4f4d\u4e0d\u4e0a\u7834', '\u9ad8\u6536\u76ca\u5229\u5dee\u4e0d\u6269\u5927', '\u7f8e\u503a\u5229\u7387\u4e0d\u518d\u51b2\u51fb\u4f30\u503c'],
      stop: recommendations.usStock.invalidations
    },
    {
      market: 'BTC',
      setup: '\u52a0\u5bc6\u52a8\u91cf + \u7f8e\u80a1\u98ce\u9669\u504f\u597d + \u6d41\u52a8\u6027',
      action: recommendations.btc.action,
      operation: recommendations.btc.action === ZH.reduce ? '\u964d\u4f4e\u73b0\u8d27\u5f39\u6027\u4ed3\uff0c\u907f\u514d\u5408\u7ea6\u6760\u6746\uff0c\u7b49\u5f85 20 \u65e5\u52a8\u91cf\u4fee\u590d\u3002' : '\u53ea\u5728 BTC \u91cd\u56de\u5747\u7ebf\u4e14 VIX/\u4fe1\u7528\u4e0d\u6076\u5316\u65f6\u52a0\u4ed3\u3002',
      confirm: [inflation?.direction || '\u901a\u80c0\u4fe1\u53f7\u4e2d\u6027', liquidity?.direction || '\u6d41\u52a8\u6027\u4e2d\u6027', '\u7f8e\u80a1\u4e0d\u540c\u6b65\u7834\u4f4d'],
      stop: recommendations.btc.invalidations
    }
  ];
}

function buildRegime(scores, quality) {
  if (!Number.isFinite(scores.riskAppetite)) {
    return { label: '\u6570\u636e\u8d28\u91cf\u4e0d\u8db3', description: '\u6838\u5fc3\u5e02\u573a\u6570\u636e\u672a\u901a\u8fc7\u65b0\u9c9c\u5ea6\u6216\u5b8c\u6574\u6027\u68c0\u67e5\uff0c\u5e94\u6682\u505c\u65b9\u5411\u5224\u65ad\u3002' };
  }
  if (quality.stale.length || quality.failed.length) {
    return { label: '\u6570\u636e\u964d\u7ea7\u8fd0\u884c', description: '\u90e8\u5206\u6570\u636e\u6e90\u5931\u8d25\u6216\u8fc7\u671f\uff0c\u4fe1\u53f7\u53ea\u80fd\u4f5c\u4e3a\u7814\u7a76\u63d0\u793a\uff0c\u9700\u4eba\u5de5\u590d\u6838\u3002' };
  }
  if (scores.riskAppetite >= 62 && safeNum(scores.dollarRatePressure, 50) <= 55) {
    return { label: '\u98ce\u9669\u504f\u597d\u6269\u5f20', description: '\u98ce\u9669\u8d44\u4ea7\u8d8b\u52bf\u5360\u4f18\uff0c\u4eba\u6c11\u5e01\u548c\u6ce2\u52a8\u7387\u538b\u529b\u53ef\u63a7\u3002' };
  }
  if (safeNum(scores.dollarRatePressure, 50) >= 65) {
    return { label: '\u5916\u90e8\u538b\u529b\u671f', description: '\u4eba\u6c11\u5e01\u3001\u6ce2\u52a8\u7387\u6216\u907f\u9669\u538b\u529b\u504f\u9ad8\uff0c\u9ad8\u6ce2\u52a8\u8d44\u4ea7\u9700\u8981\u964d\u901f\u3002' };
  }
  if (scores.riskAppetite <= 42) {
    return { label: '\u98ce\u9669\u504f\u597d\u6536\u7f29', description: '\u8de8\u8d44\u4ea7\u98ce\u9669\u504f\u597d\u504f\u5f31\uff0c\u4ed3\u4f4d\u5e94\u66f4\u91cd\u89c6\u9632\u5b88\u548c\u5931\u6548\u6761\u4ef6\u3002' };
  }
  return { label: '\u7ed3\u6784\u6027\u9707\u8361', description: '\u6ca1\u6709\u5f62\u6210\u5355\u8fb9\u5171\u632f\uff0c\u9002\u5408\u7528\u9884\u671f\u5dee\u548c\u884c\u4e1a\u5f3a\u5f31\u505a\u7ed3\u6784\u4ea4\u6613\u3002' };
}

function scoreComment(score, highText, lowText, midText) {
  if (!Number.isFinite(score)) return '\u6570\u636e\u8d28\u91cf\u4e0d\u8db3\uff0c\u6682\u505c\u8bc4\u5206\u3002';
  if (score >= 60) return highText;
  if (score <= 42) return lowText;
  return midText;
}

async function main() {
  const [quotes, macroPricing, publicDisclosure] = await Promise.all([
    fetchAll(),
    fetchMacroPricing(),
    fetchPublicDisclosureSignals()
  ]);
  const quality = buildQuality(quotes);
  const scores = scoreMarket(quotes, quality);
  const recommendations = buildRecommendations(quotes, scores, quality);
  const nowcast = buildNowcast(quotes, macroPricing);
  const impliedPricing = buildImpliedPricing(quotes, macroPricing);
  const marketTraces = buildMarketTraces(quotes, macroPricing);
  const leadLagChain = buildLeadLagChain(quotes, macroPricing);
  const generatedAt = new Date().toISOString();
  const generatedAtCN = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date());

  const data = {
    generatedAt,
    generatedAtCN,
    source: 'Tencent Finance + Binance Vision + Gate.io + CoinGecko/Coinlore fallback + Frankfurter + FRED + CNINFO/public disclosure portals',
    quality,
    scores: {
      ...Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Number.isFinite(v) ? Math.round(v) : null])),
      riskComment: scoreComment(scores.riskAppetite, '\u98ce\u9669\u8d44\u4ea7\u8868\u73b0\u8f83\u5f3a\u3002', '\u98ce\u9669\u504f\u597d\u504f\u5f31\u3002', '\u98ce\u9669\u504f\u597d\u4e2d\u6027\u3002'),
      dollarComment: scoreComment(scores.dollarRatePressure, '\u4eba\u6c11\u5e01/\u5916\u90e8\u538b\u529b\u504f\u9ad8\u3002', '\u4eba\u6c11\u5e01/\u5916\u90e8\u538b\u529b\u8f83\u4f4e\u3002', '\u4eba\u6c11\u5e01/\u5916\u90e8\u538b\u529b\u4e2d\u6027\u3002')
    },
    regime: buildRegime(scores, quality),
    recommendations,
    expectationPulse: buildPulse(quotes, scores, quality),
    nowcast,
    impliedPricing,
    marketTraces,
    publicDisclosure,
    leadLagChain,
    playbook: buildPlaybook(recommendations, nowcast, impliedPricing, marketTraces),
    macroPricing,
    quotes
  };

  const out = path.join(ROOT, 'public', 'data', 'market.json');
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`updated ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
