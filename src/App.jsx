import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bitcoin, CircleHelp, Clock, Database, ExternalLink, LineChart, RefreshCw, ShieldCheck } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const ACTION = {
  add: '加仓',
  hold: '持有',
  reduce: '减仓',
  watch: '观望',
  pause: '暂停判断'
};

const GROUP = {
  china: 'A股',
  us: '美股',
  crypto: '加密',
  macro: '全球因子'
};

const TEXT = {
  confidence: '置信度',
  advice: '交易建议',
  reasons: '依据',
  invalidations: '失效条件',
  asset: '资产',
  price: '价格',
  dayChange: '日涨跌',
  day5: '5日',
  day20: '20日',
  trend: '趋势',
  quality: '质量',
  quoteTime: '行情时间',
  pulseTitle: '预期差感知系统',
  pulseSub: '基于《预判市场》五步法',
  title: '预判市场实战看板',
  intro: '从“看数据好坏”升级为“识别预期差”：用高频 Nowcast、隐含定价、聪明钱痕迹和领先指标链，生成 A 股、美股、BTC 的可执行动作。',
  updated: '更新时间',
  source: '数据源',
  schedule: '计划：每日 07:00 / 19:00 北京时间',
  freshness: '数据质量',
  regime: '市场状态',
  risk: '风险偏好',
  pressure: '美元/利率压力',
  chinaTitle: 'A 股',
  usTitle: '美股',
  chinaAssets: 'A 股与中国资产',
  usAssets: '美股与全球风险资产',
  cryptoAssets: '加密资产',
  macroFactors: '全球定价因子',
  nowcast: '高频 Nowcast',
  impliedPricing: '市场隐含定价',
  marketTraces: '聪明钱/微观痕迹',
  publicDisclosure: '合法公示持仓/交易变动',
  leadLag: '领先指标时间链',
  playbook: '今日操作手册',
  boundary: '使用边界',
  boundaryText: '本看板是研究和决策辅助，不构成投资建议。信号依赖公开市场数据，遇到宏观数据发布、地缘冲突、流动性冲击和数据源异常时，需要人工复核。任何交易都应先定义仓位上限和失效条件。',
  loading: '正在加载市场快照...',
  loadFailed: '数据加载失败',
  help: '使用指导'
};

const actionClass = {
  [ACTION.add]: 'action add',
  [ACTION.hold]: 'action hold',
  [ACTION.reduce]: 'action reduce',
  [ACTION.watch]: 'action watch',
  [ACTION.pause]: 'action pause'
};

function fmtPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtNum(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function TrendIcon({ value }) {
  const n = Number(value);
  if (Number.isNaN(n)) return <Activity size={16} />;
  return n >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />;
}

function qualityText(q) {
  if (!q.ok) return '失败';
  if (q.stale) return '过期';
  if (q.dataQuality === 'degraded') return '降级';
  return '正常';
}

function RecommendationCard({ title, icon, item }) {
  return (
    <section className="recommendation">
      <div className="rec-top">
        <div className="rec-title">
          {icon}
          <h2>{title}</h2>
        </div>
        <span className={actionClass[item.action] || 'action watch'}>{item.action}</span>
      </div>
      <div className="confidence">
        <span>{TEXT.confidence}</span>
        <strong>{item.confidence}/100</strong>
      </div>
      <div className="meter" aria-hidden="true">
        <i style={{ width: `${item.confidence}%` }} />
      </div>
      <h3>{TEXT.advice}</h3>
      <p>{item.advice}</p>
      <h3>{TEXT.reasons}</h3>
      <ul>
        {item.reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
      <h3>{TEXT.invalidations}</h3>
      <ul>
        {item.invalidations.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
    </section>
  );
}

function QuoteTable({ title, quotes }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      <div className="table">
        <div className="thead">
          <span>{TEXT.asset}</span>
          <span>{TEXT.price}</span>
          <span>{TEXT.dayChange}</span>
          <span>{TEXT.day5}</span>
          <span>{TEXT.day20}</span>
          <span>{TEXT.trend}</span>
          <span>{TEXT.quality}</span>
        </div>
        {quotes.map((q) => (
          <div className="row" key={q.key}>
            <span className="asset">
              <b>{q.name}</b>
              <small>{q.symbol}</small>
            </span>
            <span>{fmtNum(q.price, q.price > 1000 ? 0 : 2)}</span>
            <span className={q.changePct >= 0 ? 'pos' : 'neg'}>
              <TrendIcon value={q.changePct} />
              {fmtPct(q.changePct)}
            </span>
            <span className={q.return5d >= 0 ? 'pos' : 'neg'}>{fmtPct(q.return5d)}</span>
            <span className={q.return20d >= 0 ? 'pos' : 'neg'}>{fmtPct(q.return20d)}</span>
            <span>{q.trend}</span>
            <span className={`quality ${q.ok && !q.stale ? q.dataQuality : 'failed'}`}>
              <b>{qualityText(q)}</b>
              <small>{q.quoteTime || q.quoteDate || '--'}</small>
              <small>{q.source || q.error || '--'}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PulseCard({ pulse }) {
  return (
    <section className="panel pulse">
      <div className="panel-head">
        <h2>{TEXT.pulseTitle}</h2>
        <span>{TEXT.pulseSub}</span>
      </div>
      <div className="pulse-grid">
        {pulse.map((item) => (
          <div className="pulse-item" key={item.name}>
            <span>{item.name}</span>
            <strong className={item.score >= 60 ? 'pos' : item.score <= 40 ? 'neg' : ''}>{item.score}</strong>
            <p>{item.comment}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function NowcastPanel({ items }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{TEXT.nowcast}</h2>
        <span>GDP / CPI / 流动性的前置感知</span>
      </div>
      <div className="signal-grid">
        {items.map((item) => (
          <div className="signal-card" key={item.key}>
            <div className="signal-top">
              <span>{item.name}</span>
              <strong className={item.score >= 55 ? 'pos' : item.score <= 45 ? 'neg' : ''}>{item.score}</strong>
            </div>
            <b>{item.direction}</b>
            <p>{item.tradeUse}</p>
            <ul>
              {item.evidence.map((x) => <li key={x}>{x}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function ImpliedPricingPanel({ items }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{TEXT.impliedPricing}</h2>
        <span>利率 / 通胀 / 信用 / 拥挤度</span>
      </div>
      <div className="pricing-list">
        {items.map((item) => (
          <div className="pricing-item" key={item.key}>
            <span>{item.name}</span>
            <strong>{item.value}</strong>
            <small>{item.change}</small>
            <p>{item.read}</p>
            <em>{item.source} · {item.quoteDate || '--'}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function TracePanel({ traces }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{TEXT.marketTraces}</h2>
        <span>数据公布前的跨资产痕迹</span>
      </div>
      <div className="trace-grid">
        {traces.map((item) => (
          <div className="trace-card" key={item.key}>
            <span>{item.name}</span>
            <strong>{item.signal}</strong>
            <p>{item.action}</p>
            <small>{item.evidence.join(' / ')}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function DisclosurePanel({ disclosure }) {
  if (!disclosure) return null;
  const chinaItems = disclosure.china?.items || [];
  const usSources = disclosure.us?.sources || [];
  return (
    <section className="panel disclosure">
      <div className="panel-head">
        <h2>{TEXT.publicDisclosure}</h2>
        <span>官方公告 / STOCK Act / 仅限合法公示</span>
      </div>
      <p className="disclosure-boundary">{disclosure.legalBoundary}</p>
      <div className="disclosure-grid">
        <div className="disclosure-column">
          <div className="disclosure-title">
            <h3>{disclosure.china?.title}</h3>
            <span className="status-pill">{disclosure.china?.status || '--'}</span>
          </div>
          {chinaItems.length ? chinaItems.map((item) => (
            <article className="disclosure-item" key={item.id}>
              <div>
                <strong>{item.issuer} {item.code}</strong>
                <small>{item.date || '--'} / {item.signal} / {item.freshnessLabel || '--'}</small>
              </div>
              <p>{item.title}</p>
              <small>{item.tradeUse}</small>
              <small>{item.relationScope}</small>
              <a href={item.url} target="_blank" rel="noreferrer">
                <ExternalLink size={14} />
                CNINFO
              </a>
            </article>
          )) : (
            <p className="empty-note">{disclosure.china?.error || '当前未筛到符合条件的近期公告。'}</p>
          )}
        </div>
        <div className="disclosure-column">
          <div className="disclosure-title">
            <h3>{disclosure.us?.title}</h3>
            <span className="status-pill">{disclosure.us?.status || '--'}</span>
          </div>
          <p className="empty-note">{disclosure.us?.note}</p>
          <div className="source-list">
            {usSources.map((source) => (
              <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>
                <span>
                  <strong>{source.name}</strong>
                  <small>{source.scope}</small>
                </span>
                <ExternalLink size={15} />
              </a>
            ))}
          </div>
        </div>
      </div>
      <div className="trade-use">
        <h3>交易使用方式</h3>
        <ul>
          {(disclosure.tradeUse || []).map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
    </section>
  );
}

function LeadLagPanel({ chain }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{TEXT.leadLag}</h2>
        <span>信用/流动性 → 估值/风险偏好 → PMI/利润 → 就业/通胀</span>
      </div>
      <div className="chain">
        {chain.map((item) => (
          <div className="chain-step" key={item.stage}>
            <span>{item.horizon}</span>
            <strong>{item.stage}</strong>
            <b>{item.state}</b>
            <small>{item.evidence.join(' / ')}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function PlaybookPanel({ items }) {
  return (
    <section className="panel playbook">
      <div className="panel-head">
        <h2>{TEXT.playbook}</h2>
        <span>信号 → 操作 → 确认 → 失效</span>
      </div>
      <div className="playbook-grid">
        {items.map((item) => (
          <div className="playbook-card" key={item.market}>
            <div className="rec-top">
              <h3>{item.market}</h3>
              <span className={actionClass[item.action] || 'action watch'}>{item.action}</span>
            </div>
            <p><b>设定：</b>{item.setup}</p>
            <p><b>操作：</b>{item.operation}</p>
            <p><b>确认：</b>{item.confirm.join(' / ')}</p>
            <p><b>失效：</b>{item.stop.slice(0, 2).join(' / ')}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`/data/market.json?ts=${Date.now()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  const grouped = useMemo(() => {
    if (!data) return {};
    return {
      china: data.quotes.filter((q) => q.group === GROUP.china),
      us: data.quotes.filter((q) => q.group === GROUP.us),
      crypto: data.quotes.filter((q) => q.group === GROUP.crypto),
      macro: data.quotes.filter((q) => q.group === GROUP.macro)
    };
  }, [data]);

  if (error) {
    return <main className="shell"><div className="error">{TEXT.loadFailed}: {error}</div></main>;
  }

  if (!data) {
    return <main className="shell"><div className="loading">{TEXT.loading}</div></main>;
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Market Signal Board</p>
          <h1>{TEXT.title}</h1>
          <p className="intro">{TEXT.intro}</p>
          <a className="help-link" href="/help/market-board-guide.html" target="_blank" rel="noreferrer">
            <CircleHelp size={17} />
            {TEXT.help}
          </a>
        </div>
        <div className="status">
          <span><Clock size={16} />{TEXT.updated}: {data.generatedAtCN}</span>
          <span><Database size={16} />{TEXT.source}: {data.source}</span>
          <span><RefreshCw size={16} />{TEXT.schedule}</span>
          <span><ShieldCheck size={16} />{TEXT.freshness}: {data.quality?.freshnessSummary || '--'}</span>
        </div>
      </header>

      <section className="summary">
        <div>
          <span>{TEXT.regime}</span>
          <strong>{data.regime.label}</strong>
          <p>{data.regime.description}</p>
        </div>
        <div>
          <span>{TEXT.risk}</span>
          <strong>{data.scores.riskAppetite}/100</strong>
          <p>{data.scores.riskComment}</p>
        </div>
        <div>
          <span>{TEXT.pressure}</span>
          <strong>{data.scores.dollarRatePressure}/100</strong>
          <p>{data.scores.dollarComment}</p>
        </div>
      </section>

      <div className="rec-grid">
        <RecommendationCard title={TEXT.chinaTitle} icon={<LineChart size={22} />} item={data.recommendations.aShare} />
        <RecommendationCard title={TEXT.usTitle} icon={<ShieldCheck size={22} />} item={data.recommendations.usStock} />
        <RecommendationCard title="BTC" icon={<Bitcoin size={22} />} item={data.recommendations.btc} />
      </div>

      <PulseCard pulse={data.expectationPulse} />

      <NowcastPanel items={data.nowcast || []} />
      <div className="grid-two">
        <ImpliedPricingPanel items={data.impliedPricing || []} />
        <TracePanel traces={data.marketTraces || []} />
      </div>
      <DisclosurePanel disclosure={data.publicDisclosure} />
      <LeadLagPanel chain={data.leadLagChain || []} />
      <PlaybookPanel items={data.playbook || []} />

      <div className="grid-two">
        <QuoteTable title={TEXT.chinaAssets} quotes={grouped.china} />
        <QuoteTable title={TEXT.usAssets} quotes={grouped.us} />
        <QuoteTable title={TEXT.cryptoAssets} quotes={grouped.crypto} />
        <QuoteTable title={TEXT.macroFactors} quotes={grouped.macro} />
      </div>

      <section className="panel notes">
        <div className="panel-head">
          <h2>{TEXT.boundary}</h2>
          <AlertTriangle size={18} />
        </div>
        <p>{TEXT.boundaryText}</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
