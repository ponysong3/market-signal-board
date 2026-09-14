import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import { CHANNELS, EVENT_SOURCES, affectedEvents, currentEvents, eventsShape, feedFresh, eventRisk, eventTiming, stressLoss } from './events.js';
import { signalActive } from './trading.js';

const stamp = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const sourceName = id => EVENT_SOURCES.find(s => s.id === id)?.name;
const published = e => e.precision === 'time' ? `${stamp(e.publishedAt)} 北京时间` : `${new Date(e.publishedAt).toLocaleDateString('sv-SE', { timeZone: e.sourceId === 'mofcom' ? 'Asia/Shanghai' : 'UTC' })} 发布（仅日期）`;

export function useEventFeed() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const response = await fetch('/api/events', { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('事件采集暂不可用');
      const next = await response.json();
      if (!eventsShape(next) || !feedFresh(next)) throw new Error('事件数据格式异常或已过期');
      if (mounted.current) {
        setEvents(current => current && Date.parse(current.checkedAt) > Date.parse(next.checkedAt) ? current : next);
        setError('');
      }
    } catch {
      if (mounted.current) setError('事件更新失败；保留内容按原时间失效，交易判断按覆盖不足处理。');
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; refresh();
    const interval = setInterval(() => { if (!document.hidden) refresh(); }, 300_000);
    const visible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { mounted.current = false; clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  return { events, error, busy, refresh };
}

function EventRow({ event, item }) {
  return <article className="event-row">
    <div className="event-meta"><span>{event.channels.map(k => CHANNELS[k].name).join(' / ')}</span><time>{published(event)}</time></div>
    <a href={event.url} target="_blank" rel="noreferrer">{event.title} <ExternalLink size={13} /></a>
    <small>{sourceName(event.sourceId)} · 原标题线索，非已核实投资影响{item ? ` · ${eventTiming(event, item)}` : ''}</small>
    <details><summary>传导假设、反向解释与核查</summary>{event.channels.map(k => <div className="event-channel" key={k}><b>{CHANNELS[k].name} · 条件假设</b><p>{CHANNELS[k].path}</p><p><strong>反向检查：</strong>{CHANNELS[k].counter}</p><p><strong>确认前需要：</strong>{CHANNELS[k].verify}</p></div>)}</details>
  </article>;
}

export function EventSummary({ item, context, now, active }) {
  const risk = eventRisk(item, context, now);
  return <div className={`event-summary event-${risk.key}`}><span>事件与尾部风险</span><b>{risk.label}</b><small>{active ? risk.reason : '行情未通过时效检查，不生成计划。事件线索仍可单独核查。'}</small></div>;
}

export function EventDetail({ item, context, now }) {
  const risk = eventRisk(item, context, now);
  return <section className="event-detail"><h3>事件风险与价格反应</h3><p className="event-decision"><b>{risk.label}</b>：{risk.reason}</p>
    <p className="muted">传导关联是预设敞口假设，不是公司已受影响的证据。没有事件前后高频价格和冻结预期，不能计算“已定价比例”。</p>
    {risk.relevant.map(e => <EventRow key={e.url} event={e} item={item} />)}
    {!risk.relevant.length && <p className="muted">暂无可显示的相关时效内线索；请检查来源覆盖，不能推断没有突发风险。</p>}
  </section>;
}

export function EventBoard({ feed, snapshot, context, now, market, paused, setPaused }) {
  const [scope, setScope] = useState('market');
  const [exposure, setExposure] = useState('20');
  const [gap, setGap] = useState('10');
  const items = currentEvents(feed.events, now);
  const marketItems = snapshot.candidates.filter(c => c.market === market);
  const visible = scope === 'all' ? items : items.filter(e => marketItems.some(c => affectedEvents(c, feed.events, now).some(x => x.url === e.url)));
  const healthy = feedFresh(feed.events, now) && !feed.error;
  const validSources = healthy ? feed.events.sources.filter(s => s.ok && s.invalid === 0).length : 0;
  const risks = marketItems.map(c => eventRisk(c, context, now));
  const pauses = risks.filter(r => r.multiplier === 0).length;
  const reduced = risks.filter(r => r.multiplier === 0.5).length;
  const loss = exposure.trim() && gap.trim() ? stressLoss(Number(exposure), Number(gap)) : null;
  const observations = ['csi300', 'spy', 'gld', 'tlt', 'btc'].map(key => snapshot.candidates.find(c => c.key === key)).filter(Boolean);
  return <section className="event-section" aria-label="事件与尾部风险">
    <div className="section-heading"><div><h2><ShieldAlert size={19} /> 事件与尾部风险</h2><p>预期改变 → 传导路径 → 价格验证 → 风险约束</p></div><div className="event-actions"><a href="/help/market-board-guide.html#events" target="_blank" rel="noreferrer">使用说明</a><button className="icon-button" title="刷新事件来源" aria-label="刷新事件来源" disabled={feed.busy} onClick={feed.refresh}><RefreshCw size={17} className={feed.busy ? 'spinning' : ''} /></button></div></div>
    <div className="event-strip"><div><small>72小时内相关主题</small><strong>{visible.length} 条</strong><span>线索数量，不是风险评分</span></div><div><small>有效来源检查</small><strong>{validSources} / {EVENT_SOURCES.length}</strong><span>{feed.busy ? '正在检查公开来源' : healthy ? '有限来源，不是全市场覆盖' : '覆盖未知，不等于没有风险'}</span></div><div><small>当前市场的风险约束</small><strong>{pauses} 暂停 · {reduced} 折减</strong><span>仅约束原有合格新增计划</span></div></div>
    <div className="event-controls"><label className="pause-switch"><input type="checkbox" checked={paused} onChange={e => setPaused(e.target.checked)} /> 本页暂停全部新增计划</label><select aria-label="事件范围" value={scope} onChange={e => setScope(e.target.value)}><option value="market">当前市场相关线索</option><option value="all">全部主题线索</option></select></div>
    {paused && <p className="alert" role="status">手动暂停已开启。仅限本页面，刷新后重置，不连接券商，不撤单、不卖出。</p>}
    {feed.error && <p className="alert" role="status">{feed.error}</p>}
    <p className="event-clock">来源检查：{feed.events ? `${stamp(feed.events.checkedAt)} 北京时间` : '尚未完成'}。页面可见时每5分钟检查，来源检查15分钟失效；不是秒级新闻终端。</p>
    {visible.slice(0, 3).map(e => <EventRow key={e.url} event={e} />)}
    {visible.length > 3 && <details className="more-events"><summary>其余 {visible.length - 3} 条时效内线索</summary>{visible.slice(3).map(e => <EventRow key={e.url} event={e} />)}</details>}
    {!visible.length && <p className="empty">{feed.busy ? '正在读取来源，请稍候。' : '有限来源与当前规则中没有可展示的近期相关标题；不能视为风险解除。'}</p>}
    <details className="reaction-panel"><summary>跨资产定价检查 · 最近完整日线，非事件收益</summary><div className="reaction-grid">{observations.map(c => <div key={c.key}><b>{c.symbol}</b><strong>{signalActive(c, snapshot.generatedAt, now) && Number.isFinite(c.changePct) ? `${c.changePct > 0 ? '+' : ''}${c.changePct.toFixed(2)}%` : '--'}</strong><small>{signalActive(c, snapshot.generatedAt, now) ? `${c.quoteDate} 日涨跌` : '行情待补齐'}</small></div>)}</div><p>股、债、黄金同跌可能涉及去杠杆，但不能据此断言原因。A股、美股与BTC收盘不同步，新闻可能晚于这些价格。原油、运价、实时美元/人民币、BTC资金费率与未平仓量尚未接入，需在交易终端补证。</p></details>
    <details className="stress-panel"><summary>黑天鹅应对 · 跳空压力测试</summary><p>黑天鹅不能可靠预测。先问：不能按止损价成交时，账户能承受多大损失？以下只是假设，不是事件概率、VaR或最大损失上限。</p><div className="input-grid"><label>同向风险敞口 / 账户净值（%）<input aria-label="压力测试敞口" type="number" min="0" max="100" step="1" value={exposure} onChange={e => setExposure(e.target.value)} /></label><label>不利跳空假设（%）<input aria-label="压力测试跳空" type="number" min="0" max="100" step="1" value={gap} onChange={e => setGap(e.target.value)} /></label></div><output aria-live="polite">{loss === null ? '请输入0至100之间的数值' : `假设账户损失：${loss.toFixed(2)}%（未含费用与汇率）`}</output><p>只适用无杠杆多头的简化情景；多个标的同向暴露应合并，不能把每笔0.5%风险简单当成独立风险。暂停新增、核查资金可用性和交易限制，不在失去流动性时加杠杆摊平。美债、黄金或BTC均不是必然有效的对冲。</p></details>
    <details className="event-sources"><summary>来源状态与覆盖盲区</summary>{EVENT_SOURCES.map(s => { const status = feed.events?.sources.find(x => x.id === s.id); return <p key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.name} <ExternalLink size={12} /></a>：{!healthy ? '检查过期或失败' : status?.ok ? status.invalid ? `部分解析失败 ${status.invalid} 条` : `读取成功，检查 ${status.scanned} 条` : '来源不可用'}。{s.scope}。{status?.latestPublishedAt && `源中最近发布：${stamp(status.latestPublishedAt)}（日期型按保守起点换算）。`}</p>; })}<p>只读公开标题与时间，不抓取社交传闻，不复述未核验全文。主题分类可能误报、漏报，文章发布时间不等于事件发生时间。旧标题不再展示不代表冲击已经结束，持续事件须看新证据。自然灾害、公司事故和平台中断未设专用全量监控。</p></details>
  </section>;
}
