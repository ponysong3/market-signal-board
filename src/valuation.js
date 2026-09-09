const DAY = 86_400_000;
const valid = n => typeof n === 'number' && Number.isFinite(n);
const rounded = n => Number(n.toFixed(4));
export const MODEL_REVIEW_DATE = '2026-09-09';

// These are explicit research assumptions, not consensus forecasts or fitted prices.
export const PROFILES = {
  zijin: { name: '资源周期', growth: [-5, 4, 10], pe: [10, 14, 18], discount: [14, 12, 10], haircut: [0.65, 0.8, 1], caution: '矿价、成本和资本开支可能使周期高点利润不可持续。' },
  cypc: { name: '成熟公用事业', growth: [0, 3, 5], pe: [16, 20, 24], discount: [10, 9, 8], haircut: [0.9, 1, 1], caution: '来水、电价、负债和利率变化影响利润；本模型不计期间分红，会低估分红贡献。' },
  zhongji: { name: '高增长硬件', growth: [0, 12, 22], pe: [18, 25, 32], discount: [15, 12, 10], haircut: [0.8, 1, 1], caution: '客户集中、技术替代与扩产可能改变利润率，不能把最近高增长永久外推。' },
  dongshan: { name: '电子制造', growth: [0, 8, 15], pe: [15, 20, 26], discount: [14, 11, 9], haircut: [0.8, 1, 1], caution: '客户订单、资本开支和营运资金会使会计盈利与可分配现金偏离。' },
  nvda: { name: '高增长半导体', growth: [0, 15, 25], pe: [20, 28, 36], discount: [15, 12, 10], haircut: [0.8, 1, 1], caution: 'AI投资回报、出口限制和竞争影响增长；股权激励、一次性收益需复核。' },
  msft: { name: '成熟软件与云', growth: [3, 10, 16], pe: [22, 28, 34], discount: [12, 10, 9], haircut: [0.85, 0.95, 1], caution: '资本开支和投资收益可能提高会计利润却不改善可分配现金，EPS不等于自由现金流。' }
};

export function earningsValue(eps, growth, terminalPE, discount, years = 5) {
  if (![eps, growth, terminalPE, discount, years].every(valid) || eps <= 0 || growth <= -100 || growth > 50 || terminalPE <= 0 || terminalPE > 80 || discount < 5 || discount > 25 || years !== 5) return null;
  return eps * (1 + growth / 100) ** years * terminalPE / (1 + discount / 100) ** years;
}

export function valuationFresh(v, now = Date.now()) {
  return Boolean(v?.status === 'ok' && Date.parse(v.expiresAt) > now && Date.parse(v.checkedAt) <= now + 60_000);
}

export function valueBand(price, base, low, high) {
  if (![price, base, low, high].every(valid) || Math.min(price, base, low, high) <= 0) return null;
  const margin = (base - price) / base * 100;
  return { margin: rounded(margin), upside: rounded((base / price - 1) * 100),
    state: price > high ? 'expensive' : margin >= 20 && price <= low ? 'deep' : margin >= 20 ? 'discount' : price > base ? 'premium' : 'fair' };
}

export function buildEquityValue(q, input, now = Date.now()) {
  const profile = PROFILES[q.key];
  const base = { kind: 'earnings', status: 'unavailable', label: '价值数据不足', checkedAt: new Date(now).toISOString(), input, profile, method: '五年盈利退出价折现（不含期间分红）', reviewDate: MODEL_REVIEW_DATE };
  if (!profile || !input) return { ...base, reason: '未取得对应盈利数据或估值假设。' };
  const expires = Math.min(Date.parse(input.reportDate) + 210 * DAY, Date.parse(input.publishedAt) + 150 * DAY, Date.parse(MODEL_REVIEW_DATE) + 90 * DAY);
  if (!valid(expires) || expires <= now || Date.parse(input.publishedAt) > now || Date.parse(input.reportDate) > now || Date.parse(input.annualDate) > now || now - Date.parse(input.annualDate) > 550 * DAY) return { ...base, reason: '财报期、发布时间或模型复核窗口失效。' };
  if (![input.ttmEPS, input.annualEPS, input.referencePrice].every(valid) || input.referencePrice <= 0) return { ...base, reason: '每股盈利或同日未复权价格缺失。' };
  if (input.currency !== q.currency || input.priceDate !== q.quoteDate) return { ...base, reason: '估值币种或价格日期不一致。' };
  if (input.ttmEPS <= 0 || input.annualEPS <= 0) return { ...base, reason: '存在亏损，本盈利倍数法不适用；不能把负市盈率当作便宜。' };
  if (input.shareBasisRisk) return { ...base, reason: '股本或拆股口径变化较大，需重述每股数据后估值。' };
  const normalizedEPS = Math.min(input.ttmEPS, input.annualEPS);
  const scenarios = ['保守', '基准', '乐观'].map((name, i) => {
    const eps = normalizedEPS * profile.haircut[i];
    return { name, eps: rounded(eps), growth: profile.growth[i], terminalPE: profile.pe[i], discount: profile.discount[i], years: 5, value: rounded(earningsValue(eps, profile.growth[i], profile.pe[i], profile.discount[i])) };
  });
  const [low, mid, high] = scenarios.map(s => s.value);
  const band = valueBand(input.referencePrice, mid, low, high);
  const priceBasisRisk = valid(q.price) && Math.abs(q.price / input.referencePrice - 1) > 0.005;
  const qualityFlags = [];
  if (valid(input.cashConversion) && input.cashConversion < 0.8) qualityFlags.push('经营现金流/归母利润低于0.8，盈利兑现需复核');
  if (valid(input.debtRatio) && input.debtRatio > 70) qualityFlags.push('资产负债率高于70%，杠杆风险需复核');
  if (!valid(input.cashConversion)) qualityFlags.push('未完成现金流交叉验证');
  if (priceBasisRisk) qualityFlags.push('技术前复权价与估值未复权价存在差异，先核对公司行动');
  return { ...base, status: 'ok', label: { deep: '情景安全边际较厚', discount: '基准情景有折价', fair: '安全边际有限', premium: '高于基准情景', expensive: '高于乐观情景' }[band.state],
    expiresAt: new Date(expires).toISOString(), normalizedEPS: rounded(normalizedEPS), scenarios, ...band,
    safetyPrice: rounded(mid * 0.8), pe: rounded(input.referencePrice / input.ttmEPS),
    impliedGrowth: rounded(((input.referencePrice * (1 + profile.discount[1] / 100) ** 5 / (normalizedEPS * profile.haircut[1] * profile.pe[1])) ** 0.2 - 1) * 100),
    qualityFlags, confidence: '假设敏感 / 盈利代理，非完整现金流估值',
    reason: profile.caution };
}

export function investmentView(item, now = Date.now()) {
  const v = item.valuation;
  const t = item.status;
  const technicalPlan = item.plan;
  if (!valuationFresh(v, now) || v.kind !== 'earnings') return { key: 'unverified', label: v?.kind === 'noncash' ? '无可靠现金流价值锚' : '长期价值未确认', priority: false, plan: item.type === '股票' ? null : technicalPlan, reason: item.type === '股票' ? '个股价值数据缺失或过期，暂停新增计划。' : '保留独立技术参考，不视为价值与趋势共同确认。' };
  if (['premium', 'expensive'].includes(v.state)) return { key: 'expensive', label: '情景偏贵，暂缓新增', priority: false, plan: null, reason: `在默认假设下价格高于基准情景，价值过滤撤销新增计划；${v.label}。` };
  if (v.qualityFlags.length) return { key: 'quality', label: '盈利质量待复核', priority: false, plan: null, reason: v.qualityFlags.join('；') };
  if (['deep', 'discount'].includes(v.state)) {
    if (t === 'ready') return { key: 'confluence', label: '价值与趋势共同确认', priority: true, plan: technicalPlan, reason: '基准折价至少20%且技术条件成立；仍须检查假设与实时成交条件。' };
    return { key: 'valuewatch', label: '价值观察，等待技术确认', priority: false, plan: technicalPlan, reason: '基准情景有折价不等于马上上涨，技术失效条件保持不变。' };
  }
  return { key: 'limited', label: '安全边际不足20%', priority: false, plan: technicalPlan ? { ...technicalPlan, maxPositionPct: technicalPlan.maxPositionPct / 2 } : null, reason: '价值依据有限，仅保留降低仓位上限的技术参考。' };
}
