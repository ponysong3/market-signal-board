# Market Signal Board

Daily Chinese-language trading research dashboard for A-shares, US assets and BTC spot. Existing production: https://market-signal-board.vercel.app.

## Run

```sh
npm ci
npm run update:data
npm test
npm run validate:data
npm run validate:ui-text
npm run build
npm run dev
```

## Data And Strategy

- `scripts/update-market-data.js` collects 16 curated instruments, FRED rates and credit, Cboe VIX, and public CNINFO announcements disclosed within seven days.
- `src/trading.js` owns shared closed-bar analysis, date-aware freshness checks, conditional breakout selection and risk sizing. The browser re-evaluates validity every 30 seconds, on visibility changes, and polls snapshots every five minutes.
- The strategy is an unbacktested trend/breakout screen, not a probability model, valuation engine or whole-market recommendation. Bad or missing data fails closed. Macro factors are context only.
- Equity history uses Tencent adjusted OHLCV with verified exchange suffixes. BTC uses Binance public BTCUSDT daily OHLCV with Gate.io fallback. Partial bars are excluded; relative volume excludes the current bar from its denominator.
- Snapshots expire after 14 hours. Equities require the latest expected weekday close with a 45-minute publication buffer; US timezone observes DST. Exchange holiday calendars are not supplied, so holidays can conservatively pause signals. BTC bars expire 36 hours after UTC close. FRED factors expire within seven days. Old disclosures and unavailable factor values never appear as current content.
- An expired market benchmark invalidates every dependent candidate in the browser, even if the candidate's own quote is fresh.
- Sizing inputs stay in React state. No brokerage integration, credential handling, order placement or user-input persistence is present.
- New JSON schema is version 2. Deployment must update the UI and snapshot together.

## Scheduled Updates

`.github/workflows/update-market-data.yml` runs at 23:00 and 11:00 UTC (07:00 and 19:00 Beijing), plus manual dispatch. GitHub scheduling and Vercel deployments can be delayed; this is not an intraday realtime feed. The workflow runs strategy tests, snapshot validation, Unicode text validation and build before committing a new snapshot. Concurrent runs serialize. The existing GitHub/Vercel integration publishes updated snapshots.

## Verification

`scripts/trading.test.js` exercises future/expired snapshots, stale dependencies, UTC and DST sessions, unclosed bars, historical data validation, missing volume, weak benchmark, price chasing, risk/lot caps, stale announcements and FRED missing-value parsing. `scripts/validate-market-data.js` recomputes candidate gates and validates the current snapshot before publication.

The Chinese usage guide is at `public/help/market-board-guide.html` and is linked from the dashboard header.
