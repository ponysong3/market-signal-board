import React from 'react';
import { ExternalLink } from 'lucide-react';
import { CHECKS, expectationFresh, expectationView } from './expectations.js';
import { valuationFresh } from './valuation.js';

const fmt = (x, digits = 2) => typeof x === 'number' && Number.isFinite(x) ? x.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '--';
const safeUrl = x => { try { const u = new URL(x); return u.protocol === 'https:' ? u.href : undefined; } catch { return undefined; } };

export function ExpectationSummary({ item, active, now, inactiveLabel = '行情不可用' }) {
  const view = expectationView(item, now);
  const e = item.expectation;
  return <div className={`expectation-summary expectation-${active ? view.key : 'missing'}`}>
    <span>预期与价格门槛</span><b>{active ? view.label : `${inactiveLabel}，暂停比较`}</b>
    {active && view.hurdle && <p>{e.fiscalYear}年 EPS 样本 {fmt(e.medianEPS)} / 现价要求 {fmt(view.hurdle.requiredEPS)}<small>{e.currency}/股 · 样本相对门槛 {fmt(view.gapPct)}%</small></p>}
    {active && expectationFresh(e, now) && <small>{e.count}家机构 · 最新研报 {e.asOf} · 非全市场共识</small>}
    {active && !view.hurdle && item.type === '股票' && valuationFresh(item.valuation, now) && <small>现价五年增长门槛 {fmt(item.valuation.impliedGrowth)}%/年（模型假设）</small>}
  </div>;
}

export function ExpectationDetail({ item, active, now }) {
  const e = item.expectation;
  const view = expectationView(item, now);
  const fresh = active && expectationFresh(e, now);
  return <section className="expectation-detail"><h3>预期审查 · {active ? view.label : '暂停比较'}</h3>
    {!active ? <p>行情或快照失效，撤下预测数值、变化幅度与价格门槛。</p> : <>
      <p className="expectation-decision">{view.reason}</p>
      {fresh && <>
        <dl className="anchor-metrics"><div><dt>{e.fiscalYear}年研报EPS中位数</dt><dd>{fmt(e.medianEPS, 3)} {e.currency}/股</dd></div><div><dt>机构分歧：最低至最高</dt><dd>{fmt(e.minEPS, 3)} 至 {fmt(e.maxEPS, 3)} <small>极差/中位数 {fmt(e.dispersionPct)}%</small></dd></div><div><dt>有效机构 / 同机构变化配对</dt><dd>{e.count} / {e.pairs.length} 家</dd></div><div><dt>同机构报告EPS变化中位数</dt><dd>{e.pairs.length >= 3 ? `${fmt(e.revisionMedianPct)}%` : '配对不足3家，不作方向判断'}</dd></div></dl>
        <p className="muted">最新 {e.asOf}，最早 {e.oldestDate}；仅保留最新财报披露日 {e.financialDate} 之后、45日内的预测。采集时间不是研报发布时间。{e.reason}</p>
      </>}
      {view.hurdle && <>
        <h3>市场价格要求多好的成绩？</h3>
        <p>以 {view.hurdle.priceDate} 未复权收盘 {fmt(view.hurdle.price)} {item.currency} 计算，距 {e.fiscalYear} 年末约 {fmt(view.hurdle.years)} 年。假设届时退出市盈率为 <b>{view.hurdle.terminalPE}倍</b>，要求年回报 <b>{view.hurdle.discount}%</b>，需要当年EPS约 <b>{fmt(view.hurdle.requiredEPS, 3)}</b>。</p>
        <p>样本EPS相对门槛 <b>{fmt(view.gapPct)}%</b>，样本远期P/E {fmt(view.referencePE)}倍。正数只表示样本高于这个假设门槛，<strong>不是实际业绩超预期、预期收益率或尚未被定价的证据</strong>。</p>
        <p className="muted">门槛 = 现价 × (1 + 要求年回报)^剩余年数 ÷ 假设退出P/E。沿用价值模型的基准倍数和回报率，但在对应预测年末估价；不把下一年EPS与五年增长率直接相减，不计期间分红。EPS基本/摊薄及稀释口径未逐份审计，正向比较不能升级成三重确认。</p>
      </>}
      {fresh && <details className="forecast-evidence"><summary>逐份核对预测、发布日期与机构</summary><div className="table-scroll"><table><thead><tr><th>机构</th><th>发布日期</th><th>{e.fiscalYear}年EPS</th><th>原文</th></tr></thead><tbody>{e.samples.map(r => <tr key={r.id}><td>{r.org}</td><td>{r.date}</td><td>{fmt(r.eps, 3)}</td><td><a href={safeUrl(r.url)} target="_blank" rel="noreferrer" aria-label={`查看${r.org}研报`}>研报 <ExternalLink size={12} /></a></td></tr>)}</tbody></table></div>
        {e.pairs.length > 0 && <><h4>同机构、同年度变化（旧报告只作比较基线）</h4><ul>{e.pairs.map(p => <li key={p.orgId}>{p.org}：{p.from} 的 {fmt(p.before, 3)} → {p.to} 的 {fmt(p.after, 3)}（{fmt(p.changePct)}%）。<a href={safeUrl(p.previousUrl)} target="_blank" rel="noreferrer">前次报告</a> / <a href={safeUrl(p.currentUrl)} target="_blank" rel="noreferrer">本次报告</a></li>)}</ul></>}
        <p className="muted">配对间隔至少7日，历史基线最多90日。新加入机构不会冒充预期上修；不同年度、不同币种或冲突口径不配对。股本调整仍可能影响每股数字，必须复核原文。</p>
        <a className="source-link" href={safeUrl(e.sourceUrl)} target="_blank" rel="noreferrer">{e.source} <ExternalLink size={13} /></a>
      </details>}
      <h3>下一步观察与证伪</h3><ul>{(CHECKS[item.key] || (item.market === 'CRYPTO' ? ['检查下方实际利率、信用利差和VIX是否改变风险环境，不把这些信号等同BTC方向。', '核验ETF申赎、资金费率与期权偏斜的原始时间戳；本版未接入，不凭价格上涨推断增量资金。'] : ['核对底层企业盈利预测、利率与行业驱动，不把ETF净值偏离当成预期差。', '政策变化若未改善订单、利润或现金流，就不能仅凭利好标题提高估值。'])).map(x => <li key={x}>{x}</li>)}</ul>
      <p>财报是否“超预期”还需公布前冻结的同财年、同会计口径预测，以及公布后的实际值与价格反应。本版未取得这套历史证据，不计算惊喜率，不把研报上调或利好直接变成买入信号。</p>
    </>}
    <a className="source-link" href="/help/market-board-guide.html#expectations" target="_blank" rel="noreferrer">预期、兑现与价格反应的完整说明 <ExternalLink size={13} /></a>
  </section>;
}
