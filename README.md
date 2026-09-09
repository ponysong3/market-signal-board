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
- JSON schema is version 4. Deployment must update the UI and snapshot together.

## Long-Term Value

`scripts/fetch-valuation.js` reads dated financial reports for six individual equities and structured issuer metrics for SOXX/TLT, plus same-date NAV for Chinese ETFs. `src/valuation.js` separates five-year earnings-exit valuation from technical timing. Scenario growth, terminal P/E, earnings haircut and discount rates are explicit research assumptions, not consensus or proven intrinsic values. Dividends are omitted; the result is not a complete DCF.

The default base earnings use the lower of trailing EPS and the latest annual EPS. CN TTM uses annual + current YTD - prior YTD; US TTM requires four contiguous single quarters. Negative earnings, missing periods, mismatched currency/prices, major share-count changes and expired inputs fail closed. Prices for valuation and NAV comparisons are unadjusted same-date closes. The intrinsic-value scenario never treats ETF NAV or BTC/gold as corporate cash flows.

`investmentView` combines independent technical and value evidence: valuation premiums and quality concerns cancel stock entry plans; weak technical conditions cannot be overridden by a value discount. Modest safety margins halve the technical position cap. Missing or expired stock valuation never re-enables a rejected plan. Slider scenarios are local-only and do not change published signals. Full assumptions, dates, limitations and formulas are in the Chinese help guide.

## Expectations

`scripts/fetch-expectations.js` reads dated Eastmoney A-share research reports, not an undated aggregate disguised as market consensus. `src/expectations.js` deduplicates institutions, rejects mixed years/currencies, excludes forecasts predating the latest financial update, and retains current forecasts for at most 45 days. Same-broker, same-year changes require a previous report at least seven days earlier inside the 90-day retrieval window. Fewer than three pairs cannot generate a directional revision signal. Conflicting same-day forecasts fail closed.

The model price hurdle uses the same target fiscal year as the EPS sample: price * (1 + required return)^remaining years / assumed exit multiple. This is neither an observed consensus nor an earnings surprise. Forecast EPS basis and share adjustments have not been audited, so the collector always marks `basisVerified: false`. Positive gaps cannot grant three-way confirmation. Missing, thin, unverified or divided expectations reduce otherwise eligible stock position caps; material adverse gaps or at least three material downward changes suspend entry pending review. `src/decision.js` composes this with the existing value and technical gates without resurrecting vetoed plans. Thresholds are unbacktested research choices, not trading probabilities.

US forecasts, ETF constituent consensus, BTC derivatives and pre-release frozen estimates are explicitly not covered. No synthetic earnings surprise or directional probability is generated. Existing VIX and breakeven rates remain separate macro context. The guide documents assumptions, freshness, formulas, limitations and falsification checks.

## Scheduled Updates

`.github/workflows/update-market-data.yml` runs at 23:00 and 11:00 UTC (07:00 and 19:00 Beijing), plus manual dispatch. GitHub scheduling and Vercel deployments can be delayed; this is not an intraday realtime feed. The workflow runs strategy tests, snapshot validation, Unicode text validation and build before committing a new snapshot. Concurrent runs serialize. The existing GitHub/Vercel integration publishes updated snapshots.

## Verification

`scripts/trading.test.js` exercises future/expired snapshots, stale dependencies, UTC and DST sessions, unclosed bars, historical data validation, missing volume, weak benchmark, price chasing, risk/lot caps, stale announcements and FRED missing-value parsing. `scripts/validate-market-data.js` recomputes candidate gates and validates the current snapshot before publication.

The Chinese usage guide is at `public/help/market-board-guide.html` and is linked from the dashboard header.
