import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bitcoin, Clock, Database, LineChart, RefreshCw, ShieldCheck } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const ACTION = {
  add: '\u52a0\u4ed3',
  hold: '\u6301\u6709',
  reduce: '\u51cf\u4ed3',
  watch: '\u89c2\u671b'
};

const GROUP = {
  china: '\u0041\u80a1',
  us: '\u7f8e\u80a1',
  crypto: '\u52a0\u5bc6',
  macro: '\u5168\u7403\u56e0\u5b50'
};

const TEXT = {
  confidence: '\u7f6e\u4fe1\u5ea6',
  advice: '\u4ea4\u6613\u5efa\u8bae',
  reasons: '\u4f9d\u636e',
  invalidations: '\u5931\u6548\u6761\u4ef6',
  asset: '\u8d44\u4ea7',
  price: '\u4ef7\u683c',
  dayChange: '\u65e5\u6da8\u8dcc',
  day5: '5\u65e5',
  day20: '20\u65e5',
  trend: '\u8d8b\u52bf',
  pulseTitle: '\u9884\u671f\u5dee\u611f\u77e5\u7cfb\u7edf',
  pulseSub: '\u57fa\u4e8e\u300a\u9884\u5224\u5e02\u573a\u300b\u4e94\u6b65\u6cd5',
  title: '\u5e02\u573a\u9884\u5224\u770b\u677f',
  intro: '\u7528\u9ad8\u9891\u5e02\u573a\u53d8\u91cf\u3001\u9884\u671f\u5dee\u548c\u8de8\u8d44\u4ea7\u8054\u52a8\uff0c\u751f\u6210 A \u80a1\u3001\u7f8e\u80a1\u3001BTC \u7684\u65e9\u665a\u4ea4\u6613\u5efa\u8bae\u3002',
  updated: '\u66f4\u65b0\u65f6\u95f4',
  source: '\u6570\u636e\u6e90',
  schedule: '\u8ba1\u5212\uff1a\u6bcf\u65e5 07:00 / 19:00 \u5317\u4eac\u65f6\u95f4',
  regime: '\u5e02\u573a\u72b6\u6001',
  risk: '\u98ce\u9669\u504f\u597d',
  pressure: '\u7f8e\u5143/\u5229\u7387\u538b\u529b',
  chinaTitle: 'A \u80a1',
  usTitle: '\u7f8e\u80a1',
  chinaAssets: 'A \u80a1\u4e0e\u4e2d\u56fd\u8d44\u4ea7',
  usAssets: '\u7f8e\u80a1\u4e0e\u5168\u7403\u98ce\u9669\u8d44\u4ea7',
  cryptoAssets: '\u52a0\u5bc6\u8d44\u4ea7',
  macroFactors: '\u5168\u7403\u5b9a\u4ef7\u56e0\u5b50',
  boundary: '\u4f7f\u7528\u8fb9\u754c',
  boundaryText: '\u672c\u770b\u677f\u662f\u7814\u7a76\u548c\u51b3\u7b56\u8f85\u52a9\uff0c\u4e0d\u6784\u6210\u6295\u8d44\u5efa\u8bae\u3002\u4fe1\u53f7\u4f9d\u8d56\u516c\u5f00\u5e02\u573a\u6570\u636e\uff0c\u9047\u5230\u5b8f\u89c2\u6570\u636e\u53d1\u5e03\u3001\u5730\u7f18\u51b2\u7a81\u3001\u6d41\u52a8\u6027\u51b2\u51fb\u548c\u6570\u636e\u6e90\u5f02\u5e38\u65f6\uff0c\u9700\u8981\u4eba\u5de5\u590d\u6838\u3002\u4efb\u4f55\u4ea4\u6613\u90fd\u5e94\u5148\u5b9a\u4e49\u4ed3\u4f4d\u4e0a\u9650\u548c\u5931\u6548\u6761\u4ef6\u3002',
  loading: '\u6b63\u5728\u52a0\u8f7d\u5e02\u573a\u5feb\u7167...',
  loadFailed: '\u6570\u636e\u52a0\u8f7d\u5931\u8d25'
};

const actionClass = {
  [ACTION.add]: 'action add',
  [ACTION.hold]: 'action hold',
  [ACTION.reduce]: 'action reduce',
  [ACTION.watch]: 'action watch'
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
        </div>
        <div className="status">
          <span><Clock size={16} />{TEXT.updated}: {data.generatedAtCN}</span>
          <span><Database size={16} />{TEXT.source}: {data.source}</span>
          <span><RefreshCw size={16} />{TEXT.schedule}</span>
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
