import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { earningsValue, valuationFresh, investmentView } from './valuation.js';
const fmt = (x, d = 2) => typeof x === 'number' && Number.isFinite(x) ? x.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '--';
const url = x => { try { const u = new URL(x); return u.protocol === 'https:' ? u.href : undefined; } catch { return undefined; } };
const names = { 'NAV as of': '单位净值', 'P/E Ratio': '底层P/E', 'P/B Ratio': '底层P/B', 'Effective Duration': '有效久期（年）', '30 Day SEC Yield': '30日SEC收益率（%）' };

export function ValueSummary({ item, active, now }) {
  const v = item.valuation;
  if (!active) return <div className="value-summary"><span>长期价值</span><p>价格时效不足，暂停比较。</p></div>;
  if (!valuationFresh(v, now) || v.kind !== 'earnings') return <div className="value-summary"><span>长期价值</span><b>{v?.status === 'ok' && !valuationFresh(v, now) ? '价值依据已过期' : v?.label || '价值未覆盖'}</b>{valuationFresh(v, now) && v.metrics?.length > 0 && <small>{v.metrics.slice(0, 2).map(m => `${names[m.name] || m.name} ${fmt(m.value)}`).join(' · ')}</small>}</div>;
  return <div className={`value-summary value-${v.state}`}><span>5年情景折现价值</span><b>{fmt(v.scenarios[0].value, item.decimals)}–{fmt(v.scenarios[2].value, item.decimals)} <small>{item.currency}</small></b><p>基准 {fmt(v.scenarios[1].value, item.decimals)} · 安全边际 <strong>{fmt(v.margin)}%</strong></p><small>相对基准价值的折价；负数表示溢价</small><b className="value-conclusion">{investmentView(item, now).label}</b></div>;
}

export function ValuationDetail({ item, active, now }) {
  const v = item.valuation;
  const defaults = v?.scenarios?.[1];
  const [growth, setGrowth] = useState(defaults?.growth ?? 10);
  const [discount, setDiscount] = useState(defaults?.discount ?? 10);
  const [pe, setPe] = useState(defaults?.terminalPE ?? 20);
  if (!active) return <section className="value-detail"><h3>长期价值</h3><p>价格过期，暂停价值比较及情景测算。</p></section>;
  if (!v) return <section className="value-detail"><h3>长期价值</h3><p>尚未接入价值数据。</p></section>;
  if (!valuationFresh(v, now)) return <section className="value-detail"><h3>长期价值 · {v.status === 'ok' ? '依据已过期' : v.label}</h3><p>{v.reason}</p><p className="muted">未确认长期价值的技术机会，不计入价值与趋势共同确认。</p></section>;
  if (v.kind !== 'earnings') return <section className="value-detail"><h3>{v.label}</h3><p>{v.reason}</p><dl className="anchor-metrics">{v.metrics?.map(m => <div key={m.name}><dt>{names[m.name] || m.name}</dt><dd>{fmt(m.value)} <small>截至 {m.date}</small></dd></div>)}</dl>{Number.isFinite(v.navPremium) && <p>同日价格相对净值 {fmt(v.navPremium)}%。净值偏离不是长期价值安全边际。</p>}{v.rateShock && <div className="table-scroll"><table><thead><tr><th>收益率平移假设</th><th>久期近似价格变化</th></tr></thead><tbody>{v.rateShock.map(s => <tr key={s.rateChange}><td>{s.rateChange > 0 ? '+' : ''}{s.rateChange}个百分点</td><td>{fmt(s.priceChangePct)}%</td></tr>)}</tbody></table></div>}<a className="source-link" href={url(v.sourceUrl)} target="_blank" rel="noreferrer">{v.source} <ExternalLink size={13} /></a></section>;
  const value = earningsValue(defaults.eps, growth, pe, discount);
  const customMargin = value ? (value - v.input.referencePrice) / value * 100 : null;
  const decision = investmentView(item, now);
  return <section className="value-detail"><h3>价格与长期价值 · {v.label}</h3><p>{v.method}。增长率、折现率和退出倍数均为研究假设，不是市场一致预期或已确定内在价值。</p>
    <dl className="anchor-metrics"><div><dt>比较价格（未复权收盘）</dt><dd>{fmt(v.input.referencePrice, item.decimals)} {item.currency} <small>{v.input.priceDate}</small></dd></div><div><dt>TTM摊薄EPS / 对应P/E</dt><dd>{fmt(v.input.ttmEPS, 3)} / {fmt(v.pe)}倍</dd></div><div><dt>最新完整年EPS / 基础盈利</dt><dd>{fmt(v.input.annualEPS, 3)} / {fmt(v.normalizedEPS, 3)}</dd></div><div><dt>低于基准20%的观察价</dt><dd>{fmt(v.safetyPrice, item.decimals)} {item.currency}</dd></div></dl>
    <div className="table-scroll"><table><thead><tr><th>情景</th><th>盈利基数</th><th>5年年增速</th><th>退出P/E</th><th>折现率</th><th>折现价值</th></tr></thead><tbody>{v.scenarios.map(s => <tr key={s.name}><td>{s.name}</td><td>{fmt(s.eps, 3)}</td><td>{s.growth}%</td><td>{s.terminalPE}倍</td><td>{s.discount}%</td><td>{fmt(s.value, item.decimals)}</td></tr>)}</tbody></table></div>
    <p>基准安全边际 <b>{fmt(v.margin)}%</b>，以“基准价值”为分母；回到基准的价格空间 <b>{fmt(v.upside)}%</b>，以“当前价格”为分母。两者不是同一个数字，也不代表收益预测。</p>
    <p>在基准退出倍数 {defaults.terminalPE} 倍与折现率 {defaults.discount}% 下，现价要求未来5年盈利约增长 <b>{fmt(v.impliedGrowth)}%/年</b> 才能支撑。这是反推的要求，不是未来增长预测。</p>
    <p className="value-decision"><b>{decision.label}</b>：{decision.reason}</p>
    <h3>改变假设，检查结论是否稳健</h3><div className="sensitivity-controls"><label>年盈利增长：{growth}%<input aria-label="估值年盈利增长" type="range" min="-10" max="35" step="1" value={growth} onChange={e => setGrowth(Number(e.target.value))} /></label><label>要求年回报：{discount}%<input aria-label="估值折现率" type="range" min="5" max="20" step="0.5" value={discount} onChange={e => setDiscount(Number(e.target.value))} /></label><label>5年后退出P/E：{pe}倍<input aria-label="估值退出市盈率" type="range" min="5" max="60" step="1" value={pe} onChange={e => setPe(Number(e.target.value))} /></label></div>
    <output className="custom-value" aria-live="polite">自选假设折现价值 {fmt(value, item.decimals)} {item.currency} · 安全边际 {fmt(customMargin)}%</output><p className="muted">此处是本地情景试算，不会改变默认筛选、交易计划或发布数据。期间分红未计入，不把EPS视为可全部分配的现金。</p>
    <h3>盈利质量与价值陷阱</h3><p>{v.reason}</p><p>经营现金流/盈利 {fmt(v.input.cashConversion)}；报告期ROE {fmt(v.input.roe)}%（非统一年化）；资产负债率 {fmt(v.input.debtRatio)}%。</p>{v.qualityFlags.length > 0 && <ul>{v.qualityFlags.map(x => <li key={x}>{x}</li>)}</ul>}
    <p className="muted">{v.input.basis} 财报期 {v.input.reportDate}，供应商披露/更新日 {v.input.publishedAt}，年报期 {v.input.annualDate}。模型复核日 {v.reviewDate}；有效至 {new Date(v.expiresAt).toLocaleDateString('zh-CN')}，新财报或公司行动可提前推翻假设。</p>
    <details><summary>核对盈利期间</summary><ul>{v.input.periods.map((r, i) => <li key={i}>{r.start} 至 {r.end}：EPS {fmt(r.eps, 3)}；供应商披露/更新日 {r.publishedAt}</li>)}</ul></details>
    <a className="source-link" href={url(v.input.sourceUrl)} target="_blank" rel="noreferrer">{v.input.source} <ExternalLink size={13} /></a><p className="muted">财报来自公开数据供应商，未逐份审计原始报表。会计重述、稀释、周期与资本开支仍需人工复核；情景范围不是统计置信区间。</p>
  </section>;
}
