# Market Signal Board

This is a Vite + React market dashboard based on the framework in:

`C:\Users\ponys\Documents\Obsidian Vault\投资\预判市场.md`

Core idea: trade the expectation gap, not the absolute data print. The board combines cross-asset market pricing, trend state, volatility, RMB pressure, commodities, and crypto data availability into actionable but reviewable signals.

## Features

- A-share, US stock, Bitcoin/Ethereum, FX, VIX, crude oil, and gold dashboard.
- Beijing time 07:00 and 19:00 scheduled refresh through GitHub Actions.
- Trading suggestions for A-shares, US stocks, and BTC.
- Each suggestion includes confidence, evidence, and invalidation conditions.
- Public JSON data snapshot at `public/data/market.json`.
- Data freshness and quality gates. If critical data is stale, missing, or incomplete, the affected market switches to paused judgment instead of emitting a directional signal.
- Practical prediction modules based on `预判市场.md`:
  - 高频 Nowcast: growth, inflation, liquidity, and safe-haven pressure.
  - Market-implied pricing: rates, breakeven inflation, credit spreads, and risk crowding.
  - Smart-money traces: gold/silver, oil/inflation, crypto beta, and credit/VIX interaction.
  - Lead-lag chain: liquidity -> valuation/risk appetite -> PMI/profits -> employment/inflation.
  - Daily playbook: setup, action, confirmation, and invalidation for A-shares, US stocks, and BTC.

## Data Sources

- A-share index data: Tencent Finance kline API
- US index and ETF quotes: Tencent Finance quote API
- VIX: Tencent quote API with Cboe VIX daily history fallback
- BTC/ETH: Binance Vision daily kline, Gate.io daily kline, CoinGecko fallback, Coinlore degraded fallback
- USD/CNY: Frankfurter public FX API
- Oil, gold, and silver: Tencent Finance futures quote API
- US rates, inflation breakeven, high-yield credit spread, and financial conditions: FRED CSV endpoints

If a source is blocked, the dashboard marks that asset as a data gap and avoids fabricating signals from missing prices.

## Local Development

```bash
npm install
npm run update:data
npm run validate:data
npm run dev
```

## Build

```bash
npm run build
```

## Scheduled Updates

`.github/workflows/update-market-data.yml` runs at:

- `23:00 UTC` = Beijing `07:00`
- `11:00 UTC` = Beijing `19:00`

The workflow regenerates `public/data/market.json` and commits it back to the repository.

## Risk Note

This project is a research and decision-support dashboard. It is not personalized investment advice. Every trade should define position size, invalidation conditions, and manual review requirements before execution.
