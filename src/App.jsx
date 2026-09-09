import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowUpRight, CircleHelp, Clock3, ExternalLink, RefreshCw, Search, ShieldAlert, SlidersHorizontal, X } from 'lucide-react';
import { MARKETS, STATUS, finite, snapshotFresh, signalActive, quoteFresh, recentDisclosure, marketView, positionSize } from './trading.js';
import './styles.css';
import { valuationFresh } from './valuation.js';
import { decisionView as investmentView } from './decision.js';
import { expectationFresh, expectationView } from './expectations.js';
import { ExpectationSummary, ExpectationDetail } from './Expectations.jsx';
import { ValueSummary, ValuationDetail } from './Valuation.jsx';

const fmt = (n, digits = 2) => finite(n) ? n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '--';
const pct = n => finite(n) ? `${n > 0 ? '+' : ''}${fmt(n)}%` : '--';
const time = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const statusOrder = { ready: 0, watch: 1, extended: 2, avoid: 3, blocked: 4 };
const safeUrl = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : undefined; } catch { return undefined; } };

function PriceChart({ item }) {
  const canvas = useRef(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !item.sparkline?.length) return;
    const draw = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      el.width = width * ratio; el.height = height * ratio;
      const ctx = el.getContext('2d');
      ctx.scale(ratio, ratio);
      const values = item.sparkline.map(x => x.close);
      const min = Math.min(...values); const span = Math.max(...values) - min || 1;
      ctx.strokeStyle = values.at(-1) >= values[0] ? '#087b59' : '#be4545';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = 3 + i / (values.length - 1) * (width - 6);
        const y = height - 5 - (v - min) / span * (height - 10);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw); observer.observe(el);
    return () => observer.disconnect();
  }, [item]);
  return <canvas ref={canvas} className="sparkline" role="img" aria-label={`${item.name}最近30个完整交易日收盘走势`} />;
}

function Candidate({ item, active, onSelect, now }) {
  const state = active ? item.status : 'blocked';
  const decision = investmentView(item, now);
  const p = active ? decision.plan : null;
  return <article className={`candidate state-${state}`}>
    <div className="candidate-top"><div><span className="symbol">{item.symbol} <small>{item.theme}</small></span><h3>{item.name}</h3></div><span className={`badge ${state}`}>{STATUS[state]}</span></div>
    <div className="quote-line"><strong>{active ? fmt(item.price, item.decimals) : '--'} <small>{item.currency}</small></strong><span className={item.changePct >= 0 ? 'up' : 'down'}>{active ? pct(item.changePct) : '日线不可用'}</span></div>
    {active ? <><PriceChart item={item} /><div className="stat-line"><span>20日 <b>{pct(item.return20d)}</b></span><span>相对基准 <b>{fmt(item.relativeStrength)} pp</b></span><span>规则分 <b>{item.score}/100</b></span></div></> : <p className="empty">{item.blockers?.[0] || '快照或依赖行情已过期，暂停价格与信号展示。'}</p>}
    {p ? <dl className="levels"><div><dt>突破触发</dt><dd>{fmt(p.entry, item.decimals)}</dd></div><div><dt>追价上限</dt><dd>{fmt(p.entryMax, item.decimals)}</dd></div><div><dt>止损参考</dt><dd className="down">{fmt(p.stop, item.decimals)}</dd></div><div><dt>退出参考</dt><dd>{fmt(p.target, item.decimals)}</dd></div></dl> : <p className="no-plan">{active ? item.blockers?.slice(0, 2).join('；') || '当前没有满足条件的新增计划。' : '等待下一份有效行情。'}</p>}
    <ValueSummary item={item} active={active} now={now} />
    <ExpectationSummary item={item} active={active} now={now} />
    <div className="candidate-bottom"><small>{active ? `${item.quoteDate} 收盘` : '暂停新增判断'}{p ? ` · 净收益/风险 ${fmt(p.rr)}:1` : ''}</small><button className="detail-button" onClick={() => onSelect(item.key)}>查看依据 <ArrowUpRight size={15} /></button></div>
  </article>;
}

function Detail({ item, active, onClose, now }) {
  const dialog = useRef(null);
  const [capital, setCapital] = useState('');
  const [risk, setRisk] = useState('0.5');
  useEffect(() => {
    const el = dialog.current;
    const focus = document.activeElement;
    el.showModal();
    return () => { el.close(); focus?.focus(); };
  }, []);
  const p = active ? investmentView(item, now).plan : null;
  const size = p ? positionSize(p, Number(capital), Number(risk), item.lot) : null;
  return <dialog ref={dialog} className="detail" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="detail-head"><div><span className="symbol">{item.symbol} · {item.currency}</span><h2>{item.name}</h2></div><button className="icon-button" title="关闭详情" aria-label="关闭详情" onClick={onClose}><X size={20} /></button></div>
    <span className={`badge ${active ? item.status : 'blocked'}`}>{active ? STATUS[item.status] : '暂停判断'}</span>
    {active ? <><h3>筛选依据</h3><ul>{item.reasons.map(x => <li key={x}>{x}</li>)}</ul><p className="muted">规则分衡量条件满足程度，不是上涨概率；候选池不是全市场排名。</p></> : <p className="alert">快照、标的或基准日线已经失效，原有价格计划已撤下。</p>}
    <ValuationDetail key={item.valuation?.checkedAt || item.key} item={item} active={active} now={now} />
    <ExpectationDetail item={item} active={active} now={now} />
    {active && item.blockers.length > 0 && <><h3>技术面还缺什么</h3><ul>{item.blockers.map(x => <li key={x}>{x}</li>)}</ul></>}
    {p && <><h3>执行条件</h3><p>{p.confirmation}</p><p>触发 {fmt(p.entry, item.decimals)}，最高 {fmt(p.entryMax, item.decimals)}；止损参考 {fmt(p.stop, item.decimals)}，退出参考 {fmt(p.target, item.decimals)} {item.currency}。退出参考按波动幅度计算，不是估值或收益预测。</p><h3>失效与退出</h3><p>{p.invalidation}</p>
      <section className="calculator"><h3><SlidersHorizontal size={17} /> 仓位测算</h3><div className="input-grid"><label>账户资金（{item.currency}）<input type="number" min="0" step="100" value={capital} placeholder="输入同币种资金" onChange={e => setCapital(e.target.value)} /></label><label>单笔风险预算（%）<input type="number" min="0.1" max="2" step="0.1" value={risk} onChange={e => setRisk(e.target.value)} /></label></div>
      {size ? <dl className="sizing"><div><dt>测算数量</dt><dd>{fmt(size.units, item.market === 'CRYPTO' ? 5 : 0)} {item.market === 'CRYPTO' ? 'BTC' : '股/份'}</dd></div><div><dt>预计占用</dt><dd>{fmt(size.value)} {item.currency}</dd></div><div><dt>计划内损失</dt><dd>{fmt(size.risk)} {item.currency}</dd></div></dl> : <p className="muted">输入有效资金及0至2%之间的风险预算后测算。</p>}
      {size?.units === 0 && <p className="alert">风险或仓位预算不足以买入一个最小单位，放弃本次计划。</p>}
      <p className="muted">按追价上限计算，单标的仓位上限 {p.maxPositionPct}%，估算往返费用与滑点 {fmt(p.costRate * 100)}%。跳空、跌停或滑点可能使实际损失超过预算。</p></section></>}
    <h3>下单前复核</h3><p>{item.market === 'CN' ? '股票及本候选池股票ETF按T+1约束处理；停牌、涨跌停、除权与公告需在交易终端核对。' : item.market === 'US' ? '核对盘前跳空、公司财报/分红、ETF分配与交易时段；不要把前复权历史价格直接当作实时成交报价。' : '仅展示BTC/USDT现货，不含杠杆。报价以USDT计价，并非严格美元价格；核对实际平台价差和最小订单规则。'}</p>
    <p>近期研报只是部分机构样本，不是全市场一致预期。财报事件日历、实时盘口和全市场资金流未接入，不能断言突发事件是否已被定价。先在交易终端复核，再决定是否执行。</p>
    {item.sourceUrl && <a className="source-link" href={safeUrl(item.sourceUrl)} target="_blank" rel="noreferrer">{item.source} · {item.quoteDate || '时间未知'} <ExternalLink size={14} /></a>}
  </dialog>;
}

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [market, setMarket] = useState('CN');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const response = await fetch(`/data/market.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = await response.json();
      if (next.schemaVersion !== 4 || !Array.isArray(next.candidates) || !next.candidates.every(c => c.expectation) || !Array.isArray(next.factors) || !next.disclosures || !next.quality || !Number.isFinite(Date.parse(next.generatedAt))) throw new Error('快照格式不兼容');
      if (mounted.current) { setData(next); setError(''); setCheckedAt(Date.now()); }
    } catch (e) { if (mounted.current) setError(`获取最新快照失败：${e.message}`); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; refresh();
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const poll = setInterval(refresh, 5 * 60_000);
    const visible = () => { if (!document.hidden) { setNow(Date.now()); refresh(); } };
    document.addEventListener('visibilitychange', visible);
    return () => { mounted.current = false; clearInterval(tick); clearInterval(poll); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  if (!data) return <main className="shell"><h1>市场分析看板</h1><p role="status">{error || '正在读取市场快照…'}</p>{error && <button onClick={refresh}>重新加载</button>}</main>;
  const fresh = snapshotFresh(data.generatedAt, now);
  const active = c => signalActive(c, data.generatedAt, now);
  const all = data.candidates.filter(c => c.market === market);
  const filtered = all.filter(c => `${c.name} ${c.symbol} ${c.theme}`.toLowerCase().includes(search.toLowerCase())).filter(c => {
    const decision = investmentView(c, now);
    if (filter === 'all') return true;
    if (filter === 'plans') return active(c) && decision.plan;
    if (filter === 'value') return active(c) && valuationFresh(c.valuation, now) && ['deep', 'discount'].includes(c.valuation.state);
    if (filter === 'expensive') return active(c) && decision.key === 'expensive';
    if (filter === 'expectation') return active(c) && ['demanding', 'down', 'divided'].includes(expectationView(c, now).key);
    return !active(c) || ['avoid', 'extended'].includes(c.status) || ['expensive', 'quality', 'expectation_risk'].includes(decision.key);
  })
    .sort((a, b) => (statusOrder[active(a) ? a.status : 'blocked'] - statusOrder[active(b) ? b.status : 'blocked']) || (b.score ?? -1) - (a.score ?? -1));
  const views = Object.keys(MARKETS).map(m => marketView(m, data.candidates, now));
  const selectedItem = data.candidates.find(c => c.key === selected);
  const factors = fresh ? data.factors.filter(f => Date.parse(f.expiresAt) > now && (f.key !== 'vix' || quoteFresh({ ok: true, market: 'US', quoteDate: f.quoteDate }, now))) : [];
  const news = fresh ? data.disclosures.items.filter(x => recentDisclosure(x, now)) : [];
  const currentValid = data.candidates.filter(active).length;
  return <main className="shell">
    <header className="header"><div className="brand"><Activity size={25} /><div><h1>市场分析看板</h1><p>日线交易参考 · A股 / 美股 / BTC</p></div></div><nav><span className={`live-dot ${fresh ? '' : 'expired'}`}>{fresh ? '快照有效' : '快照过期'}</span><button className="icon-button" onClick={refresh} disabled={busy} title="检查最新快照（不会触发数据采集）" aria-label="检查最新快照"><RefreshCw size={18} className={busy ? 'spinning' : ''} /></button><a className="icon-button" href="/help/market-board-guide.html" target="_blank" rel="noreferrer" title="使用指导" aria-label="使用指导"><CircleHelp size={20} /></a></nav></header>
    <div className="timestamp"><span><Clock3 size={14} /> 生成于 {time(data.generatedAt)} 北京时间</span><span>每日 07:00 / 19:00 更新 · 非盘中实时行情</span><span>有效候选行情 {currentValid}/{data.candidates.length}</span>{checkedAt && <span>检查于 {time(checkedAt)}</span>}</div>
    {!fresh && <p className="alert" role="alert"><ShieldAlert size={18} /> 快照超过14小时或时间异常，已撤下全部交易价格和建议。等待数据更新后恢复。</p>}
    {error && <p className="alert" role="alert">{error}。当前保留的快照仍按实际时效检查。</p>}
    <section className="market-strip" aria-label="市场环境">{views.map(v => <button key={v.market} className={`market-overview ${market === v.market ? 'chosen' : ''}`} onClick={() => { setMarket(v.market); setSearch(''); }}><span>{MARKETS[v.market]} <ArrowUpRight size={15} /></span><strong>{fresh ? v.state : '暂停判断'}</strong><p>{fresh ? v.reason : '需要新快照，暂不判断方向。'}</p><small>{fresh ? `基准收盘 ${v.quoteDate || '--'}` : '数据已过期'}</small></button>)}</section>
    <section className="workspace">
      <div className="section-heading"><div><h2>标的、价值、预期与执行条件</h2><p>技术时机 + 长期价值 + 预期兑现门槛 · 规则分仅代表技术条件</p></div><span className="counter">{all.filter(c => active(c) && investmentView(c, now).priority).length} 三重确认 / {all.length} 候选</span></div>
      <div className="toolbar"><div className="tabs" role="tablist" aria-label="选择市场">{Object.entries(MARKETS).map(([key, label]) => <button key={key} role="tab" aria-selected={market === key} onClick={() => { setMarket(key); setSearch(''); }}>{label}</button>)}</div><label className="search"><Search size={16} /><input aria-label="搜索代码或名称" placeholder="代码、名称或板块" value={search} onChange={e => setSearch(e.target.value)} /></label><select aria-label="筛选状态" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部状态</option><option value="plans">有条件计划</option><option value="value">价值折价观察</option><option value="expensive">情景估值偏贵</option><option value="expectation">预期门槛 / 分歧风险</option><option value="risks">回避 / 暂停</option></select></div>
      {all.every(c => !active(c) || !investmentView(c, now).priority) && <p className="market-note">当前没有价值、预期与趋势共同确认的标的。盈利预测高不等于价格便宜；现价可能已要求更高的增长。</p>}
      <div className="candidate-grid">{filtered.map(c => <Candidate key={c.key} item={c} active={active(c)} now={now} onSelect={setSelected} />)}</div>
      {!filtered.length && <p className="empty">没有符合当前筛选条件的标的。</p>}
    </section>
    <section className="factor-section"><div className="section-heading"><div><h2>宏观定价与市场预期</h2><p>隐含通胀与波动预期分别观察；利率变化以基点计，不直接触发买卖</p></div></div>{factors.length ? <div className="factor-grid">{factors.map(f => <article key={f.key} className="factor"><h3>{f.name}</h3><strong>{fmt(f.value)}<small>{f.unit}</small></strong><span>{finite(f.change5obsBp) ? `较5个有效观测前 ${fmt(f.change5obsBp)} bp` : '期权隐含波动率'}</span><p>{f.meaning}</p><small>关联：{f.exposure}</small><a href={safeUrl(f.sourceUrl)} target="_blank" rel="noreferrer">{f.quoteDate} · {f.source} <ExternalLink size={12} /></a></article>)}</div> : <p className="empty">暂无时效窗口内的宏观价格，未展示旧数值。</p>}</section>
    {news.length > 0 && <section className="news-section"><div className="section-heading"><div><h2>近7日公开公告</h2><p>按披露日筛选；披露日不等于交易日，公告不参与技术评分</p></div></div>{news.map(n => <a className="news-row" key={n.id} href={safeUrl(n.url)} target="_blank" rel="noreferrer"><time>{n.date}</time><strong>{n.issuer} {n.code}</strong><span>{n.title}</span><ExternalLink size={16} /></a>)}</section>}
    <details className="quality"><summary>数据状态与覆盖边界 · {data.quality.issues.length} 项行情/宏观采集缺口</summary><p>{data.strategy}</p><p>仅筛选16个预设标的，代表不同敞口，不是全市场选股或基本面评级。黄金、美债ETF同样使用美股基准门槛，防守阶段不会自动推荐其对冲。</p><p>有效行情按交易地收盘和周末检查；法定假期未接入专用日历，宁可保守暂停。BTC只用完整UTC日线，最多容忍收盘后36小时；整个快照14小时失效。</p><p>近期公告：{data.disclosures.failedQueries ? `${data.disclosures.failedQueries}组查询失败，覆盖不完整` : `${news.length}条符合当前窗口`}。美国官员法定披露仅保留官方检索入口，未接入可核验的近期交易记录。</p><p>A股部分机构研报样本已接入；全市场一致预期、另类数据、期权大单仍未覆盖，不将普通涨跌包装为这些信号。各类价值与预期缺口在下方单列。</p>{data.quality.issues.length > 0 && <ul>{data.quality.issues.map((x, i) => <li key={i}>{x.name}：{x.reason}</li>)}</ul>}<p><a href="https://disclosures-clerk.house.gov/FinancialDisclosure" target="_blank" rel="noreferrer">美国众议院披露入口</a> · <a href="https://efdsearch.senate.gov/search/" target="_blank" rel="noreferrer">美国参议院披露入口</a></p></details>
    <section className="valuation-coverage"><h3>价值依据覆盖</h3><p>{fresh ? data.candidates.filter(c => active(c) && c.valuation?.kind === 'earnings' && valuationFresh(c.valuation, now)).length : 0}/6只个股有时效内的盈利情景估值。股票ETF底层估值覆盖仍有限，净值偏离不代表长期低估；黄金与BTC不发布现金流内在价值。技术评分与价值情景分开呈现。</p></section>
    <section className="valuation-coverage"><h3>预期依据覆盖</h3><p>{data.candidates.filter(c => active(c) && expectationFresh(c.expectation, now)).length}/6只个股有时效内的机构研报样本；其中 {data.candidates.filter(c => active(c) && expectationFresh(c.expectation, now) && c.expectation.count >= 3).length} 只覆盖至少3家机构。样本来自A股公开研报，美股机构预测、ETF底层预期、BTC衍生品定价尚未接入。研报每股口径未逐份核验，不授予三重确认。</p><p>未采集公布前冻结的一致预期和发布后的同口径实际值，不计算“业绩惊喜率”或“政策超预期分”。<a href="/help/market-board-guide.html#expectations">预期的定义、公式和使用边界</a></p></section>
    <footer>日线计划需在下单前复核实时价格和事件风险。估值依赖假设，未回测，非自动交易；止损参考不是成交或最大损失保证。<a href="/help/market-board-guide.html">完整使用指导 <CircleHelp size={14} /></a></footer>
    {selectedItem && <Detail key={selectedItem.key} item={selectedItem} active={active(selectedItem)} now={now} onClose={() => setSelected(null)} />}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
