import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

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
  strong: '\u5f3a\u52bf',
  weak: '\u5f31\u52bf',
  shortStrong: '\u77ed\u5f3a',
  choppy: '\u9707\u8361',
  intradayStrong: '\u65e5\u5185\u504f\u5f3a',
  intradayWeak: '\u65e5\u5185\u504f\u5f31',
  insufficient: '\u6570\u636e\u4e0d\u8db3',
  abnormal: '\u6570\u636e\u5f02\u5e38',
  dailyFx: '\u65e5\u9891\u6c47\u7387',
  add: '\u52a0\u4ed3',
  hold: '\u6301\u6709',
  reduce: '\u51cf\u4ed3',
  watch: '\u89c2\u671b'
};

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
  { key: 'btc', group: ZH.crypto, name: 'Bitcoin', symbol: 'BTC-USD', coinId: 'bitcoin' },
  { key: 'eth', group: ZH.crypto, name: 'Ethereum', symbol: 'ETH-USD', coinId: 'ethereum' }
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
  return Math.max(min, Math.min(max, n));
}

function trendLabel(price, ma20, ma60) {
  if (!Number.isFinite(price) || !Number.isFinite(ma20) || !Number.isFinite(ma60)) return ZH.insufficient;
  if (price > ma20 && ma20 > ma60) return ZH.strong;
  if (price > ma20) return ZH.shortStrong;
  if (price < ma20 && ma20 < ma60) return ZH.weak;
  return ZH.choppy;
}

async function httpText(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 market-signal-board/0.1',
      accept: '*/*'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function httpJson(url) {
  return JSON.parse(await httpText(url));
}

function buildQuoteFromCloses(item, rows, latestMeta = {}) {
  const closes = rows.map((row) => Number(row.close)).filter(Number.isFinite);
  const volumes = rows.map((row) => Number(row.volume)).filter(Number.isFinite);
  const price = Number.isFinite(latestMeta.price) ? latestMeta.price : closes.at(-1);
  const previousClose = Number.isFinite(latestMeta.previousClose) ? latestMeta.previousClose : closes.at(-2);
  const ma20 = avg(closes.slice(-20));
  const ma60 = avg(closes.slice(-60));
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
    ok: Number.isFinite(price)
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
  return buildQuoteFromCloses(item, rows);
}

function parseTencentQuoteLine(line, item) {
  const match = line.match(/="([^"]*)"/);
  if (!match) throw new Error(`${item.symbol} quote parse failed`);
  const fields = match[1].split('~');
  const price = Number(fields[3]);
  const previousClose = Number(fields[4]);
  const changePct = Number(fields[32]);
  const high = Number(fields[33]);
  const low = Number(fields[34]);
  return {
    ...item,
    price,
    previousClose,
    changePct: Number.isFinite(changePct) ? changePct : pct(price, previousClose),
    return5d: null,
    return20d: null,
    return60d: null,
    ma20: null,
    ma60: null,
    volume: Number(fields[6]) || null,
    avgVolume20: null,
    high,
    low,
    trend: Number.isFinite(price) && Number.isFinite(previousClose)
      ? price >= previousClose ? ZH.intradayStrong : ZH.intradayWeak
      : ZH.insufficient,
    ok: Number.isFinite(price)
  };
}

async function fetchTencentQuotes(items) {
  const url = `https://qt.gtimg.cn/q=${items.map((x) => x.symbol).join(',')}`;
  const text = await httpText(url);
  const lines = text.split(';').map((x) => x.trim()).filter(Boolean);
  return items.map((item) => {
    const line = lines.find((x) => x.includes(`_${item.symbol}=`));
    if (!line) return { ...item, ok: false, price: null, changePct: null, trend: ZH.abnormal, error: 'quote missing' };
    try {
      return parseTencentQuoteLine(line, item);
    } catch (err) {
      return { ...item, ok: false, price: null, changePct: null, trend: ZH.abnormal, error: err.message };
    }
  });
}

async function fetchCrypto(item) {
  const url = `https://api.coingecko.com/api/v3/coins/${item.coinId}/market_chart?vs_currency=usd&days=120&interval=daily`;
  const body = await httpJson(url);
  const rows = (body.prices || []).map(([ts, price]) => ({
    date: new Date(ts).toISOString().slice(0, 10),
    close: Number(price),
    volume: null
  }));
  if (rows.length < 2) throw new Error(`${item.coinId} no price history`);
  return buildQuoteFromCloses(item, rows);
}

async function fetchFxAndFutures() {
  const results = [];

  try {
    const fx = await httpJson('https://api.frankfurter.app/latest?from=USD&to=CNY');
    const price = Number(fx.rates?.CNY);
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
      ok: Number.isFinite(price)
    });
  } catch (err) {
    results.push({ key: 'usdcny', group: ZH.factor, name: ZH.usdcny, symbol: 'USD/CNY', ok: false, price: null, changePct: null, trend: ZH.abnormal, error: err.message });
  }

  try {
    const text = await httpText('https://qt.gtimg.cn/q=hf_GC,hf_CL');
    const lines = text.split(';').map((x) => x.trim()).filter(Boolean);
    for (const [key, symbol, name] of [['oil', 'hf_CL', ZH.oil], ['gold', 'hf_GC', ZH.gold]]) {
      const line = lines.find((x) => x.includes(`_${symbol}=`));
      const match = line?.match(/="([^"]*)"/);
      if (!match) {
        results.push({ key, group: ZH.factor, name, symbol, ok: false, price: null, changePct: null, trend: ZH.abnormal, error: 'quote missing' });
        continue;
      }
      const fields = match[1].split(',');
      const price = Number(fields[0]);
      const change = Number(fields[1]);
      const previousClose = Number(fields[7]) || null;
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
        ok: Number.isFinite(price)
      });
    }
  } catch (err) {
    results.push({ key: 'oil', group: ZH.factor, name: ZH.oil, symbol: 'hf_CL', ok: false, price: null, changePct: null, trend: ZH.abnormal, error: err.message });
    results.push({ key: 'gold', group: ZH.factor, name: ZH.gold, symbol: 'hf_GC', ok: false, price: null, changePct: null, trend: ZH.abnormal, error: err.message });
  }

  return results;
}

async function safe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    return { ...label, ok: false, price: null, changePct: null, trend: ZH.abnormal, error: err.message };
  }
}

async function fetchAll() {
  const aQuotes = await Promise.all(TENCENT_A.map((item) => safe(item, () => fetchTencentA(item))));
  const usQuotes = await fetchTencentQuotes(TENCENT_US);
  const cryptoQuotes = await Promise.all(CRYPTO.map((item) => safe(item, () => fetchCrypto(item))));
  const factors = await fetchFxAndFutures();
  return [...aQuotes, ...usQuotes, ...cryptoQuotes, ...factors];
}

function byKey(quotes, key) {
  return quotes.find((q) => q.key === key) || {};
}

function safeNum(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function scoreMarket(quotes) {
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

  const aMomentum = clamp(50
    + safeNum(sse.return20d) * 1.3
    + safeNum(szse.return20d) * 0.9
    + safeNum(chinext.return20d) * 0.7
    + (sse.price > sse.ma20 ? 6 : -4)
    + (sse.price > sse.ma60 ? 6 : -4));

  const usMomentum = clamp(50
    + safeNum(nasdaq.changePct) * 5
    + safeNum(qqq.changePct) * 3
    + safeNum(spx.changePct) * 3
    - Math.max(0, safeNum(vix.price, 18) - 18) * 1.6);

  const cryptoMomentum = btc.ok ? clamp(50
    + safeNum(btc.return20d) * 1.4
    + safeNum(btc.return5d) * 1.2
    + (btc.price > btc.ma20 ? 7 : -5)
    + (btc.price > btc.ma60 ? 7 : -5)
    - Math.max(0, safeNum(vix.price, 18) - 20)) : 45;

  const dollarRatePressure = clamp(45
    + Math.max(0, safeNum(usdcny.price, 7) - 7) * 18
    + Math.max(0, safeNum(vix.price, 18) - 18) * 1.3
    + safeNum(gold.changePct) * 2
    + Math.max(0, safeNum(oil.changePct)) * 1.5);

  const riskAppetite = clamp(avg([usMomentum, cryptoMomentum, aMomentum]) ?? 50);

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

function actionFromScore(score) {
  if (score >= 66) return ZH.add;
  if (score >= 53) return ZH.hold;
  if (score >= 42) return ZH.watch;
  return ZH.reduce;
}

function buildRecommendations(quotes, scores) {
  const sse = byKey(quotes, 'sse');
  const nasdaq = byKey(quotes, 'nasdaq');
  const btc = byKey(quotes, 'btc');
  const vix = byKey(quotes, 'vix');
  const usdcny = byKey(quotes, 'usdcny');

  const aScore = clamp(scores.aMomentum - Math.max(0, scores.dollarRatePressure - 55) * 0.4);
  const usScore = clamp(scores.usMomentum - Math.max(0, safeNum(vix.price, 18) - 22) * 2);
  const btcScore = btc.ok ? clamp(scores.cryptoMomentum - Math.max(0, scores.dollarRatePressure - 58) * 0.5) : 42;

  const aAction = actionFromScore(aScore);
  const usAction = actionFromScore(usScore);
  const btcAction = btc.ok ? actionFromScore(btcScore) : ZH.watch;

  return {
    aShare: {
      action: aAction,
      confidence: Math.round(aScore),
      advice: aAction === ZH.add
        ? 'A \u80a1\u8d8b\u52bf\u548c\u4eba\u6c11\u5e01\u73af\u5883\u76f8\u5bf9\u914d\u5408\uff0c\u53ef\u63d0\u9ad8\u7ed3\u6784\u6027\u4ed3\u4f4d\uff0c\u4f18\u5148\u9009\u62e9\u5f3a\u8d8b\u52bf\u3001\u771f\u4e1a\u7ee9\u548c\u653f\u7b56\u4e3b\u7ebf\u3002'
        : aAction === ZH.reduce
          ? 'A \u80a1\u98ce\u9669\u504f\u597d\u504f\u5f31\uff0c\u4f18\u5148\u964d\u4f4e\u9ad8\u5f39\u6027\u9898\u6750\u548c\u4e8f\u635f\u80a1\uff0c\u4fdd\u7559\u7ea2\u5229\u3001\u73b0\u91d1\u6d41\u548c\u5f3a\u57fa\u672c\u9762\u4ed3\u4f4d\u3002'
          : '\u7ef4\u6301\u89c2\u5bdf\u6216\u7ed3\u6784\u6027\u6301\u4ed3\u3002\u53ea\u5728\u884c\u4e1a\u5f3a\u5ea6\u3001\u6210\u4ea4\u989d\u548c\u4eba\u6c11\u5e01\u7a33\u5b9a\u5171\u632f\u65f6\u63d0\u9ad8\u4ed3\u4f4d\u3002',
      reasons: [
        `\u4e0a\u8bc1 20 \u65e5\u8868\u73b0 ${fmtSigned(sse.return20d)}\uff0c\u8d8b\u52bf\u72b6\u6001\uff1a${sse.trend}`,
        `USD/CNY \u5f53\u524d ${fmtPlain(usdcny.price)}\uff0c\u7528\u4e8e\u5ba1\u67e5\u4eba\u6c11\u5e01\u538b\u529b`,
        `A \u80a1\u52a8\u91cf\u8bc4\u5206 ${Math.round(scores.aMomentum)}/100`
      ],
      invalidations: [
        '\u4eba\u6c11\u5e01\u5feb\u901f\u8d2c\u503c\u4e14\u6e2f\u80a1/\u4e2d\u56fd\u8d44\u4ea7\u540c\u6b65\u8d70\u5f31',
        'A \u80a1\u6307\u6570\u8dcc\u7834 20/60 \u65e5\u5747\u7ebf\u4e14\u6210\u4ea4\u989d\u653e\u5927\u4e0b\u8dcc',
        '\u653f\u7b56\u9884\u671f\u5151\u73b0\u540e\u9898\u6750\u9ad8\u4f4d\u653e\u91cf\u6ede\u6da8'
      ]
    },
    usStock: {
      action: usAction,
      confidence: Math.round(usScore),
      advice: usAction === ZH.add
        ? '\u7f8e\u80a1\u98ce\u9669\u504f\u597d\u8f83\u5f3a\uff0c\u53ef\u6301\u6709\u6216\u5c0f\u5e45\u63d0\u9ad8\u4f18\u8d28\u79d1\u6280/\u6307\u6570\u4ed3\u4f4d\uff0c\u4ecd\u9700\u63a7\u5236\u4f30\u503c\u548c\u6ce2\u52a8\u7387\u51b2\u51fb\u3002'
        : usAction === ZH.reduce
          ? '\u7f8e\u80a1\u627f\u538b\uff0c\u4f18\u5148\u964d\u4f4e\u9ad8\u4f30\u503c\u957f\u4e45\u671f\u8d44\u4ea7\uff0c\u7b49\u5f85\u6ce2\u52a8\u7387\u538b\u529b\u7f13\u548c\u3002'
          : '\u7f8e\u80a1\u7ef4\u6301\u6301\u6709\u6216\u89c2\u671b\uff0cAI \u4e3b\u7ebf\u53ef\u7ee7\u7eed\u8ddf\u8e2a\uff0c\u4f46\u4e0d\u8ffd\u9ad8\u4f4e\u8d54\u7387\u4f4d\u7f6e\u3002',
      reasons: [
        `\u7eb3\u65af\u8fbe\u514b\u65e5\u6da8\u8dcc ${fmtSigned(nasdaq.changePct)}\uff0c\u8d8b\u52bf\u72b6\u6001\uff1a${nasdaq.trend}`,
        `VIX \u5f53\u524d ${fmtPlain(vix.price)}\uff0c\u6050\u614c/\u6ce2\u52a8\u7387\u5f71\u54cd\u98ce\u9669\u504f\u597d`,
        `\u7f8e\u80a1\u52a8\u91cf\u8bc4\u5206 ${Math.round(scores.usMomentum)}/100`
      ],
      invalidations: [
        'VIX \u5347\u7834 25 \u4e14\u6807\u666e\u8dcc\u7834\u5173\u952e\u5747\u7ebf',
        'AI \u8d44\u672c\u5f00\u652f\u6216\u9f99\u5934\u8d22\u62a5\u4f4e\u4e8e\u9884\u671f',
        '\u7f8e\u5143/\u5229\u7387\u538b\u529b\u91cd\u65b0\u62ac\u5347\u5e76\u538b\u5236\u4f30\u503c'
      ]
    },
    btc: {
      action: btcAction,
      confidence: Math.round(btcScore),
      advice: btc.ok
        ? (btcAction === ZH.add
          ? 'BTC \u8d8b\u52bf\u4e0e\u98ce\u9669\u504f\u597d\u5171\u632f\uff0c\u53ef\u5728\u65e2\u5b9a\u4ed3\u4f4d\u4e0a\u9650\u5185\u5206\u6279\u52a0\u4ed3\uff0c\u5fc5\u987b\u8bbe\u7f6e\u56de\u64a4\u548c\u6760\u6746\u98ce\u9669\u9608\u503c\u3002'
          : btcAction === ZH.reduce
            ? 'BTC \u9762\u4e34\u98ce\u9669\u504f\u597d\u6216\u7f8e\u5143\u538b\u529b\uff0c\u964d\u4f4e\u9ad8\u6ce2\u52a8\u4ed3\u4f4d\uff0c\u907f\u514d\u6760\u6746\u548c\u8ffd\u6da8\u3002'
            : 'BTC \u7ef4\u6301\u89c2\u5bdf\u6216\u8f7b\u4ed3\u6301\u6709\u3002\u7b49\u5f85\u4ef7\u683c\u8d8b\u52bf\u3001\u7f8e\u5143\u8d70\u5f31\u548c\u8d44\u91d1\u6d41\u5171\u632f\u3002')
        : 'BTC \u5b9e\u65f6\u6570\u636e\u6e90\u672a\u6253\u901a\uff0c\u6682\u4e0d\u7528\u9519\u8bef\u6570\u636e\u751f\u6210\u65b9\u5411\u4fe1\u53f7\uff1b\u5148\u4ee5\u7f8e\u80a1\u98ce\u9669\u504f\u597d\u548c VIX \u4f5c\u4e3a\u98ce\u9669\u4ee3\u7406\u3002',
      reasons: [
        `BTC 20 \u65e5\u8868\u73b0 ${fmtSigned(btc.return20d)}\uff0c\u8d8b\u52bf\u72b6\u6001\uff1a${btc.trend || ZH.abnormal}`,
        `VIX \u5f53\u524d ${fmtPlain(vix.price)}\uff0c\u7528\u4e8e\u5ba1\u67e5\u98ce\u9669\u504f\u597d`,
        `\u52a0\u5bc6\u52a8\u91cf\u8bc4\u5206 ${Math.round(scores.cryptoMomentum)}/100`
      ],
      invalidations: [
        'BTC \u8dcc\u7834 20/60 \u65e5\u5747\u7ebf\u4e14\u653e\u91cf\u4e0b\u884c',
        'VIX \u5feb\u901f\u4e0a\u884c\u5bfc\u81f4\u98ce\u9669\u8d44\u4ea7\u540c\u6b65\u56de\u64a4',
        'ETF \u8d44\u91d1\u6301\u7eed\u6d41\u51fa\u6216\u5408\u7ea6\u6760\u6746\u6e05\u7b97\u98ce\u9669\u5347\u6e29'
      ]
    }
  };
}

function buildPulse(quotes, scores) {
  const vix = byKey(quotes, 'vix');
  const usdcny = byKey(quotes, 'usdcny');
  const oil = byKey(quotes, 'oil');
  const gold = byKey(quotes, 'gold');
  return [
    {
      name: '\u98ce\u9669\u504f\u597d',
      score: Math.round(scores.riskAppetite),
      comment: `\u7531\u7f8e\u80a1\u3001BTC \u548c VIX \u5408\u6210\u3002VIX \u5f53\u524d ${fmtPlain(vix.price)}\u3002`
    },
    {
      name: '\u4eba\u6c11\u5e01\u7a33\u5b9a',
      score: Math.round(clamp(70 - Math.max(0, safeNum(usdcny.price, 7) - 7) * 18)),
      comment: `USD/CNY \u5f53\u524d ${fmtPlain(usdcny.price)}\uff0c\u4e0a\u884c\u4ee3\u8868\u4eba\u6c11\u5e01\u5151\u7f8e\u5143\u8d70\u5f31\u3002`
    },
    {
      name: '\u5546\u54c1\u538b\u529b',
      score: Math.round(clamp(50 + safeNum(oil.changePct) * 4 + safeNum(gold.changePct) * 2)),
      comment: `\u539f\u6cb9\u65e5\u6da8\u8dcc ${fmtSigned(oil.changePct)}\uff0c\u9ec4\u91d1\u65e5\u6da8\u8dcc ${fmtSigned(gold.changePct)}\u3002`
    },
    {
      name: '\u9884\u671f\u5dee\u654f\u611f\u5ea6',
      score: Math.round(clamp(35 + Math.max(0, safeNum(vix.price, 18) - 15) * 3)),
      comment: '\u6ce2\u52a8\u7387\u8d8a\u9ad8\uff0c\u6570\u636e\u516c\u5e03\u524d\u540e\u7684\u9884\u671f\u5dee\u4ea4\u6613\u8d8a\u654f\u611f\u3002'
    }
  ];
}

function buildRegime(scores) {
  if (scores.riskAppetite >= 62 && scores.dollarRatePressure <= 55) {
    return { label: '\u98ce\u9669\u504f\u597d\u6269\u5f20', description: '\u98ce\u9669\u8d44\u4ea7\u8d8b\u52bf\u5360\u4f18\uff0c\u4eba\u6c11\u5e01\u548c\u6ce2\u52a8\u7387\u538b\u529b\u53ef\u63a7\u3002' };
  }
  if (scores.dollarRatePressure >= 65) {
    return { label: '\u5916\u90e8\u538b\u529b\u671f', description: '\u4eba\u6c11\u5e01\u3001\u6ce2\u52a8\u7387\u6216\u907f\u9669\u538b\u529b\u504f\u9ad8\uff0c\u9ad8\u6ce2\u52a8\u8d44\u4ea7\u9700\u8981\u964d\u901f\u3002' };
  }
  if (scores.riskAppetite <= 42) {
    return { label: '\u98ce\u9669\u504f\u597d\u6536\u7f29', description: '\u8de8\u8d44\u4ea7\u98ce\u9669\u504f\u597d\u504f\u5f31\uff0c\u4ed3\u4f4d\u5e94\u66f4\u91cd\u89c6\u9632\u5b88\u548c\u5931\u6548\u6761\u4ef6\u3002' };
  }
  return { label: '\u7ed3\u6784\u6027\u9707\u8361', description: '\u6ca1\u6709\u5f62\u6210\u5355\u8fb9\u5171\u632f\uff0c\u9002\u5408\u7528\u9884\u671f\u5dee\u548c\u884c\u4e1a\u5f3a\u5f31\u505a\u7ed3\u6784\u4ea4\u6613\u3002' };
}

async function main() {
  const quotes = await fetchAll();
  const scores = scoreMarket(quotes);
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
    source: 'Tencent Finance + CoinGecko + Frankfurter public APIs',
    scores: {
      ...Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Math.round(v)])),
      riskComment: scores.riskAppetite >= 60 ? '\u98ce\u9669\u8d44\u4ea7\u8868\u73b0\u8f83\u5f3a\u3002' : scores.riskAppetite <= 42 ? '\u98ce\u9669\u504f\u597d\u504f\u5f31\u3002' : '\u98ce\u9669\u504f\u597d\u4e2d\u6027\u3002',
      dollarComment: scores.dollarRatePressure >= 62 ? '\u4eba\u6c11\u5e01/\u5916\u90e8\u538b\u529b\u504f\u9ad8\u3002' : scores.dollarRatePressure <= 45 ? '\u4eba\u6c11\u5e01/\u5916\u90e8\u538b\u529b\u8f83\u4f4e\u3002' : '\u4eba\u6c11\u5e01/\u5916\u90e8\u538b\u529b\u4e2d\u6027\u3002'
    },
    regime: buildRegime(scores),
    recommendations: buildRecommendations(quotes, scores),
    expectationPulse: buildPulse(quotes, scores),
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
