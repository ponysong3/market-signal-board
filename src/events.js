import { HOUR, signalActive, quoteFresh, snapshotFresh, finite } from './trading.js';

export const EVENT_TTL = 72 * HOUR;
export const FEED_TTL = 15 * 60_000;
export const EVENT_SOURCES = [
  { id: 'un', name: '联合国新闻', url: 'https://news.un.org/feed/subscribe/zh/news/all/rss.xml', format: 'rss', scope: '全球局势公开报道，非独立战场核验' },
  { id: 'mofcom', name: '中国商务部', url: 'https://www.mofcom.gov.cn/xwfb/index.html', format: 'mofcom', scope: '贸易政策与发言，不含全部部门公告' },
  { id: 'fed', name: '美联储', url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', format: 'rss', scope: '货币政策公告，不含全部官员讲话' },
  { id: 'ofac', name: '美国财政部 OFAC', url: 'https://ofac.treasury.gov/recent-actions', format: 'ofac', scope: '制裁、许可与名单变更，须逐项核对对象' }
];

const tech = ['chip', 'chinext', 'zhongji', 'dongshan', 'qqq', 'soxx', 'nvda', 'msft'];
export const CHANNELS = {
  energy: { name: '能源与航运', keys: null,
    path: '若航道或能源供给受阻 → 运费、能源成本上升 → 利润与通胀预期重估。',
    counter: '若供应替代、库存释放或需求走弱抵消冲击，油价与运价未必持续上升；黄金、美债也不保证上涨。',
    verify: '核查实际航道通行、保险与运价、原油供给；本版未接入这些实时数据。' },
  trade: { name: '贸易与制裁', keys: ['csi300', 'zijin', ...tech, 'spy'],
    path: '若限制适用于企业产品、客户或结算 → 可服务市场、成本和收入预期改变。',
    counter: '许可、豁免或取消限制可能缓和影响；某一实体被制裁不等于整个行业受限。',
    verify: '核查生效日、适用主体、产品清单、豁免，以及公司公告和收入敞口。' },
  geopolitical: { name: '地缘与安全', keys: null,
    path: '若冲突扩散或关键设施中断 → 供应链与风险溢价变化 → 股票、利率和避险需求重估。',
    counter: '停火、局部化或预期已提前反映，可能使价格反向运动；无法由标题确定影响幅度。',
    verify: '核对原文中的事实与引述，事件是否升级、是否涉及关键基础设施，再看跨资产反应。' },
  liquidity: { name: '利率与流动性', keys: null,
    path: '若政策路径或融资条件改变 → 折现率与杠杆成本变化 → 长久期股票、美债与BTC重新定价。',
    counter: '宽松若缘于衰退或流动性危机，风险资产仍可能下跌；公告发布不等于政策超预期。',
    verify: '核对政策原文、此前预期、实际利率和信用利差；没有公布前冻结共识，不计算惊喜率。' },
  disruption: { name: '突发中断', keys: [...tech, 'btc'],
    path: '若网络、交易平台或关键生产设施中断 → 运营、交割或流动性风险上升。',
    counter: '事件范围、持续时间和冗余系统决定影响；网络安全公告不一定表示已发生攻击。',
    verify: '先核查交易所、公司或监管原文；确认能否交易、提款、交割，不猜测传言。' }
};

// Topic matching is triage only. Negations, forecasts and historical references
// must never become machine-confirmed events or directional trading signals.
export function classifyEvent(title, sourceId) {
  if (/周年|纪念|回顾|anniversary|retrospective/i.test(title)) return [];
  const result = [];
  if (/霍尔木兹|红海|苏伊士|航运|航道|石油|原油|油轮|能源供|天然气|hormuz|red sea|suez|oil supply|tanker/i.test(title)) result.push('energy');
  if (sourceId === 'ofac' || /制裁|关税|出口管制|反倾销|实体清单|贸易限制|许可|sanction|tariff|export control/i.test(title)) result.push('trade');
  if (/伊朗|以色列|也门|乌克兰|俄罗斯|台海|台湾|核电站|核设施|核武|停火|iran|israel|ukraine|taiwan|ceasefire|nuclear/i.test(title)) result.push('geopolitical');
  if (sourceId === 'fed' || /流动性危机|银行挤兑|紧急降息|bank run|liquidity crisis|emergency rate/i.test(title)) result.push('liquidity');
  if (/网络攻击|网络安全|交易所.*(?:中断|暂停|黑客)|大规模停电|地震|海啸|cyberattack|exchange outage|earthquake/i.test(title)) result.push('disruption');
  return result;
}

export function eventUrl(value, sourceId) {
  try {
    const source = EVENT_SOURCES.find(s => s.id === sourceId);
    if (!source) return null;
    const u = new URL(value, source.url);
    if (u.protocol !== 'https:' || u.origin !== new URL(source.url).origin || u.username || u.password) return null;
    u.hash = ''; u.search = '';
    return u.href;
  } catch { return null; }
}

export function eventsShape(data) {
  return data?.schemaVersion === 1 && Number.isFinite(Date.parse(data.checkedAt))
    && Array.isArray(data.sources) && data.sources.length === EVENT_SOURCES.length
    && EVENT_SOURCES.every(s => data.sources.filter(x => x?.id === s.id).length === 1)
    && data.sources.every(s => s && typeof s.ok === 'boolean' && Number.isInteger(s.invalid) && s.invalid >= 0 && Number.isInteger(s.scanned) && s.scanned >= 0)
    && Array.isArray(data.items) && data.items.length <= 120
    && data.items.every(e => e && typeof e.title === 'string' && e.title.length > 0 && e.title.length <= 500
      && eventUrl(e.url, e.sourceId) === e.url && Number.isFinite(Date.parse(e.publishedAt))
      && Date.parse(e.publishedAt) <= Date.parse(data.checkedAt)
      && ['date', 'time'].includes(e.precision) && Array.isArray(e.channels)
      && e.channels.length > 0 && e.channels.every(k => CHANNELS[k]));
}

export function feedFresh(data, now = Date.now()) {
  const age = now - Date.parse(data?.checkedAt);
  return eventsShape(data) && age >= 0 && age < FEED_TTL;
}

export function currentEvents(data, now = Date.now()) {
  if (!feedFresh(data, now)) return [];
  const seen = new Set();
  return data.items.filter(e => {
    const age = now - Date.parse(e.publishedAt);
    const key = `${e.sourceId}|${e.title.trim().toLowerCase()}`;
    if (age < 0 || age >= EVENT_TTL || seen.has(key) || seen.has(e.url)) return false;
    seen.add(key); seen.add(e.url); return true;
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export function affectedEvents(item, data, now = Date.now()) {
  return currentEvents(data, now).filter(e => e.channels.some(k => !CHANNELS[k].keys || CHANNELS[k].keys.includes(item.key)));
}

export function eventRisk(item, context, now = Date.now()) {
  const { events, snapshot, paused, failed } = context || {};
  const relevant = affectedEvents(item, events, now);
  if (paused) return { key: 'paused', label: '本页已暂停新增', multiplier: 0, relevant, reason: '手动风险开关已开启；不影响已有持仓，不会提交或撤销订单。' };
  const active = snapshot && signalActive(item, snapshot.generatedAt, now);
  const threshold = item.market === 'CRYPTO' ? 8 : 5;
  if (active && finite(item.changePct) && Math.abs(item.changePct) >= threshold)
    return { key: 'shock', label: '日线异常波动：暂停新增', multiplier: 0, relevant, reason: `最新完整日涨跌幅${item.changePct.toFixed(2)}%，绝对值达到${threshold}%研究阈值。先核查消息、跳空与盘口；不据此认定黑天鹅或事件因果。` };
  const benchmarkKey = item.market === 'CN' ? 'csi300' : item.market === 'US' ? 'spy' : 'btc';
  const benchmark = snapshot?.candidates?.find(c => c.key === benchmarkKey);
  const vix = snapshot?.factors?.find(f => f.key === 'vix');
  if (active && benchmark && signalActive(benchmark, snapshot.generatedAt, now)
      && finite(benchmark.changePct) && benchmark.changePct <= -2
      && snapshotFresh(snapshot.generatedAt, now) && vix && finite(vix.value) && vix.value >= 30
      && Date.parse(vix.expiresAt) > now && quoteFresh({ ok: true, market: 'US', quoteDate: vix.quoteDate }, now))
    return { key: 'stress', label: '压力共振：暂停新增', multiplier: 0, relevant, reason: '有效VIX≥30且本市场基准日跌幅≥2%。不同市场收盘不同步，这是保守风控规则，不是危机概率。' };
  const complete = !failed && feedFresh(events, now) && events.sources.every(s => s.ok === true && s.invalid === 0);
  if (!complete) return { key: 'unknown', label: '事件覆盖不足：仓位折半', multiplier: 0.5, relevant, reason: '事件源缺失、过期或解析不完整。未知不等于安全；只对原有合格计划减半，不生成买点。' };
  if (relevant.length) return { key: 'review', label: '相关事件待核查：仓位折半', multiplier: 0.5, relevant, reason: `${relevant.length}条72小时内的相关主题线索，尚未核实对本标的的具体影响。仅作审慎折减，不自动判定利好、利空或已经定价。` };
  return { key: 'monitor', label: '有限来源内无匹配线索', multiplier: 1, relevant, reason: '当前规则未匹配到相关标题，不代表无风险。仍须核对实时盘口、公司公告和交易平台状态。' };
}

export function applyEventRisk(base, risk) {
  return { ...base, event: risk, priority: base.priority && risk.multiplier === 1,
    key: base.plan && risk.multiplier === 0 ? 'event_risk' : base.key,
    label: base.plan && risk.multiplier < 1 ? risk.label : base.label,
    plan: !base.plan || risk.multiplier === 0 ? null : { ...base.plan, maxPositionPct: base.plan.maxPositionPct * risk.multiplier },
    reason: `${base.reason} ${risk.reason}` };
}

export function stressLoss(exposure, gap) {
  if (![exposure, gap].every(x => finite(x) && x >= 0 && x <= 100)) return null;
  return exposure * gap / 100;
}

export function eventTiming(event, item) {
  if (!item.quoteDate) return '缺少可比较的收盘日期';
  const zone = item.market === 'CN' ? 'Asia/Shanghai' : item.market === 'US' ? 'America/New_York' : 'UTC';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(event.publishedAt));
  const part = k => parts.find(p => p.type === k).value;
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  if (event.precision === 'date') return '仅有发布日期，不能确定事件与日线的先后';
  return date > item.quoteDate ? '发布后尚无完整日线，不能判断价格反应' : date === item.quoteDate ? '同日发布，日线无法区分盘中先后' : '有较晚日线，但涨跌不能直接归因于此事件';
}
