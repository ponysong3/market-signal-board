export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const SNAPSHOT_TTL = 14 * HOUR;
export const UPDATE_SCHEDULE = '每日07:00 / 19:00；A股工作日15:50收盘补采（北京时间）';
export const MARKETS = { CN: 'A股', US: '美股', CRYPTO: '比特币' };
export const STATUS = { ready: '优先观察', watch: '等待确认', extended: '不追高', avoid: '回避新增', blocked: '暂停判断' };
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = n => Number(n.toFixed(6));
export const finite = x => typeof x === 'number' && Number.isFinite(x);

export function dateInZone(time, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time)).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function expectedSession(market, now = Date.now()) {
  if (market === 'CRYPTO') return new Date(now - DAY).toISOString().slice(0, 10);
  const local = dateInZone(now, market === 'CN' ? 'Asia/Shanghai' : 'America/New_York');
  let day = Date.parse(`${local.date}T00:00:00Z`);
  if (local.minutes < (market === 'CN' ? 15 : 16) * 60 + 45) day -= DAY;
  while ([0, 6].includes(new Date(day).getUTCDay())) day -= DAY;
  return new Date(day).toISOString().slice(0, 10);
}

export function snapshotFresh(generatedAt, now = Date.now()) {
  const age = now - Date.parse(generatedAt);
  return Number.isFinite(age) && age >= -60_000 && age <= SNAPSHOT_TTL;
}

export function quoteFresh(q, now = Date.now()) {
  if (!q?.ok || !/^\d{4}-\d{2}-\d{2}$/.test(q.quoteDate || '')) return false;
  const end = Date.parse(`${q.quoteDate}T00:00:00Z`) + DAY;
  if (!Number.isFinite(end) || end > now + DAY) return false;
  if (q.market === 'CRYPTO') return now >= end && now - end <= 36 * HOUR;
  return q.quoteDate === expectedSession(q.market, now);
}

export function signalActive(item, generatedAt, now = Date.now()) {
  return signalStatus(item, generatedAt, now).active;
}

export function signalStatus(item, generatedAt, now = Date.now()) {
  if (!snapshotFresh(generatedAt, now)) return { active: false, label: '快照已失效', reason: '快照超过14小时或生成时间异常，等待重新采集。' };
  if (!item?.ok) return { active: false, label: '行情采集异常', reason: item?.error || '未取得有效行情，暂停判断。' };
  if (!quoteFresh(item, now)) {
    const expected = expectedSession(item.market, now);
    const waiting = /^\d{4}-\d{2}-\d{2}$/.test(item.quoteDate || '') && item.quoteDate < expected;
    return { active: false, label: waiting ? '等待收盘更新' : '行情日期异常', reason: waiting
      ? `等待${expected}收盘数据；当前仅有${item.quoteDate}日线，暂不使用旧价格生成计划。`
      : '行情日期缺失、尚未收盘或已超过有效窗口，暂停判断。' };
  }
  if (!item.dependencies?.length || !item.dependencies.every(q => quoteFresh(q, now))) return { active: false, label: '等待基准更新', reason: '标的行情可用，但市场基准未覆盖最近应有收盘，暂停依赖它的交易判断。' };
  return { active: true, label: '行情有效', reason: '' };
}

export function recentDisclosure(item, now = Date.now()) {
  const time = Date.parse(`${item.date}T00:00:00+08:00`);
  return Number.isFinite(time) && now >= time && now - time <= 7 * DAY;
}

// Only complete daily OHLCV bars enter the indicators and breakout references.
export function analyzeBars(instrument, input, now = Date.now()) {
  const lastAllowed = expectedSession(instrument.market, now);
  const rows = input.filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') && r.date <= lastAllowed)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 65) throw new Error('少于65根完整日线');
  if (new Set(rows.map(r => r.date)).size !== rows.length) throw new Error('日线日期重复');
  if (rows.some((r, i) => ![r.open, r.high, r.low, r.close, r.volume].every(finite) || r.low <= 0 || r.volume < 0 || r.high < Math.max(r.open, r.close, r.low) || r.low > Math.min(r.open, r.close) || (i && Date.parse(r.date) - Date.parse(rows[i - 1].date) > 15 * DAY))) throw new Error('日线价格或连续性异常');
  const last = rows.at(-1);
  const close = rows.map(r => r.close);
  const ranges = rows.slice(1).map((r, i) => Math.max(r.high - r.low, Math.abs(r.high - rows[i].close), Math.abs(r.low - rows[i].close)));
  let atr = mean(ranges.slice(0, 14));
  for (const value of ranges.slice(14)) atr = (atr * 13 + value) / 14;
  if (!(atr > 0)) throw new Error('缺少有效波动区间');
  const avgVolume = mean(rows.slice(-21, -1).map(r => r.volume));
  const result = {
    ...instrument, ok: true, quoteDate: last.date, price: last.close,
    changePct: (last.close / close.at(-2) - 1) * 100,
    return5d: (last.close / close.at(-6) - 1) * 100,
    return20d: (last.close / close.at(-21) - 1) * 100,
    ma20: mean(close.slice(-20)), ma60: mean(close.slice(-60)), atr,
    high20: Math.max(...rows.slice(-21, -1).map(r => r.high)),
    low10: Math.min(...rows.slice(-10).map(r => r.low)),
    volumeRatio: avgVolume > 0 ? last.volume / avgVolume : null,
    bars: rows.length,
    sparkline: rows.slice(-30).map(r => ({ date: r.date, close: r.close }))
  };
  return result;
}

export function marketView(market, quotes, now = Date.now()) {
  const key = { CN: 'csi300', US: 'spy', CRYPTO: 'btc' }[market];
  const q = quotes.find(q => q.key === key);
  if (!quoteFresh(q, now)) return { market, key, state: '暂停判断', reason: '基准日线缺失或未覆盖最近应有收盘，暂停新增仓位判断。', allowLong: false, quoteDate: q?.quoteDate || null };
  const strong = q.price > q.ma20 && q.ma20 > q.ma60;
  const weak = q.price < q.ma60;
  return { market, key, state: strong ? '顺势筛选' : weak ? '防守观察' : '等待趋势', reason: strong ? '基准收盘价 > 20日均线 > 60日均线，可筛选同向候选。' : weak ? '基准低于60日均线，优先控制已有敞口。' : '短中期趋势尚未同时确认，等待收盘结构改善。', allowLong: strong, quoteDate: q.quoteDate, return20d: q.return20d };
}

export function buildCandidate(q, benchmark, now = Date.now()) {
  const base = { ...q, dependencies: benchmark ? [{ market: benchmark.market, quoteDate: benchmark.quoteDate, ok: benchmark.ok }] : [], status: 'blocked', plan: null, score: null, reasons: [], blockers: [] };
  if (!quoteFresh(q, now)) return { ...base, blockers: [q.error || '未覆盖最近应有收盘；节假日也会保守暂停，需人工复核。'] };
  if (!quoteFresh(benchmark, now)) return { ...base, blockers: ['市场基准缺失或过期，暂停入场判断。'] };
  const rs = q.return20d - benchmark.return20d;
  const strong = q.price > q.ma20 && q.ma20 > q.ma60;
  const marketStrong = benchmark.price > benchmark.ma20 && benchmark.ma20 > benchmark.ma60;
  const tick = q.tick;
  const up = x => round(Math.ceil(x / tick) * tick);
  const down = x => round(Math.floor(x / tick) * tick);
  const entry = up(q.high20 + tick);
  const entryMax = up(entry + q.atr * 0.25);
  const stop = down(entry - q.atr * 1.5);
  const target = up(entry + q.atr * 3.5);
  const cost = q.market === 'CRYPTO' ? 0.004 : q.market === 'CN' ? 0.003 : 0.002;
  const loss = entryMax - stop + entryMax * cost;
  const reward = target - entryMax - entryMax * cost;
  const rr = reward / loss;
  const extended = q.price > entryMax || (q.price - q.ma20) / q.atr > 3;
  const volumeOk = finite(q.volumeRatio) && q.volumeRatio >= 1.2;
  const eligible = strong && marketStrong && rs >= 0 && stop > 0 && rr >= 1.5;
  const status = !strong || !marketStrong ? 'avoid' : extended ? 'extended' : eligible && q.price >= entry && volumeOk ? 'ready' : 'watch';
  const reasons = [
    `20日涨幅 ${q.return20d.toFixed(2)}%，相对基准 ${rs >= 0 ? '+' : ''}${rs.toFixed(2)} 个百分点`,
    `收盘 ${q.price.toFixed(q.decimals)} / MA20 ${q.ma20.toFixed(q.decimals)} / MA60 ${q.ma60.toFixed(q.decimals)}`,
    `完整日成交量 / 前20日均量 ${finite(q.volumeRatio) ? q.volumeRatio.toFixed(2) + '倍' : '缺失'}`
  ];
  const blockers = [];
  if (!strong) blockers.push('标的尚未形成收盘价 > MA20 > MA60');
  if (!marketStrong) blockers.push('市场基准趋势未确认');
  if (rs < 0) blockers.push('20日表现落后于基准');
  if (!volumeOk) blockers.push('成交量尚未达到前20日均量的1.2倍');
  if (q.price < entry) blockers.push('尚未收盘突破前20日高点');
  if (extended) blockers.push('超过追价上限或偏离MA20超过3 ATR');
  if (rr < 1.5 || stop <= 0) blockers.push('扣除估算成本后风险收益比不足');
  const score = Math.round((strong ? 30 : 0) + (marketStrong ? 20 : 0) + (rs >= 0 ? 15 : 0) + (volumeOk ? 15 : 0) + (q.price >= entry ? 10 : 0) + (!extended ? 10 : 0));
  const plan = ['ready', 'watch'].includes(status) && stop > 0 && rr >= 1.5 ? {
    entry, entryMax, stop, target, rr: round(rr), costRate: cost, lossPerUnit: round(loss),
    maxPositionPct: q.market === 'CRYPTO' ? 5 : q.type === '宽基ETF' ? 20 : 10,
    confirmation: '仅在基准与标的趋势成立、相对强度不为负、完整日线放量突破后，下一交易时段复核价格仍在入场区间；所有条件同时成立才考虑试仓。',
    invalidation: '跌破止损参考价、收盘跌破MA20、基准转弱或数据过期，撤销新增计划并复核已有仓位。'
  } : null;
  return { ...base, status, score, relativeStrength: rs, reasons, blockers, plan };
}

export function positionSize(plan, capital, riskPct, lot) {
  if (!plan || ![capital, riskPct, lot].every(finite) || capital <= 0 || riskPct <= 0 || riskPct > 2 || lot <= 0) return null;
  const budget = capital * riskPct / 100;
  const raw = Math.min(budget / plan.lossPerUnit, capital * plan.maxPositionPct / 100 / plan.entryMax);
  const units = round(Math.floor(raw / lot) * lot);
  return { units, value: units * plan.entryMax, risk: units * plan.lossPerUnit, budget };
}
