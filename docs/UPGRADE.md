# Multi-strategy engine upgrade

## Why the platform made one trade a day (root causes found in the code)

| # | Cause | Where |
|---|-------|-------|
| 1 | A single `state.pending` slot held a trade from entry until its OCO exit fired, so nothing else could trade meanwhile | `protected-demo.js`, `orders.js`, `cycle.js` |
| 2 | Hard caps: `Math.min(maxTrades, 3)` orders/day (= one round trip), experimental entries `< 1`/day, `One order per research cycle`, any open position blocks entry | `protected-demo.js`, `manager.js`, `cycle.js` |
| 3 | `riskPerTrade` was treated as the whole principal ($1.50), so positions were ~$3 on a $100 allocation | `protected-demo.js` |
| 4 | Cron ran hourly while candles are 15 min (3 of 4 candles never evaluated) | `vercel.json`, `cycle.js` |
| 5 | Entries required the LLM news and strategy agents; OpenAI 429s degraded 11 cycles on 2026-11-26 and blocked trading | `cycle.js` |
| 6 | Admin settings validation capped orders/day at 10 (30 stored) and daily volume at 100% of capital | `settings.js` |

## The more important finding: the old signals had no edge

The system's own forward paper test (512 observations in `lessons`) shows, at the actual ~0.10%/side fee:

| rule | n | gross mean/trade | net at 0.20% round trip | 95% CI (net) |
|------|---|------------------|-------------------------|--------------|
| trend | 385 | +0.068% | -0.132% | [-0.24%, -0.02%] |
| pullback | 40 | +0.19% | ~-0.01% | includes 0 |
| breakout / reversion | small | negative | negative | - |

1-hour holds on 15-minute signals earn less than the fees. Running those rules more often would lose money faster, so
this upgrade does not simply remove throttles. Trade frequency now comes from *validated, cost-aware, diversified* strategies.

## What was built

**Strategy library** (`lib/strategies.js`): pullback-trend, Donchian breakout, Bollinger/RSI(2) mean reversion, squeeze-expansion,
cross-sectional relative strength. 11 variants (stop/target/hold differ). Long-only spot. ATR(1h)-scaled stop and target.
**Cost gate**: target must clear round-trip cost x 3.5 (tunable guard), which filters out low-volatility pairs automatically.

**Regime + market state** (`lib/series.js`): per-pair trend/range/squeeze/mixed from 1h EMA20/50 + ADX; BTC-led risk-on/neutral/off.
All indicators are causal (tested: appending future bars never changes past values).

**Shadow trading** (`lib/shadow.js`): every cost-qualified signal is simulated as a paper bracket trade (pessimistic fills:
stop wins ties, gaps fill at open). Hundreds of unbiased observations per day without orders.

**Allocator** (`lib/allocator.js`): decayed (21-day half-life) per strategy/variant/pair/regime statistics, hierarchical shrinkage
from a skeptical prior of -0.10R, Thompson sampling. Each arm is `live` (lower bound > 0 over >=20 trades; risk 0.5x-1.5x by edge/noise),
`probe` (exploration at 0.25x risk, capped per day), `shadow` (paper only) or `disabled` (negative with >=30 trades).

**Autonomous learning loop** (`lib/postmortem.js`): deterministic loss classification (fast-stop, market-beta, late-entry, weak-volume,
fee-drag, time-drift). Guards (BTC-drop filter, max extension, breakout volume, cost multiple, cooldown) move one bounded step at a time,
one experiment at a time, and automatically revert if the next 30 outcomes are worse. Live-vs-paper fill gaps recalibrate the slippage assumption.
The learner can never touch hard risk limits, the kill switch, or order authority.

**Concurrent execution** (`lib/executor.js`, `lib/engine-quote.js`): `state.pending` is now only a short dispatch slot; filled trades move
to `state.book` with native OPOCO exits on the exchange. Risk-based sizing from stop distance with limits on position, allocation,
wallet, daily volume, portfolio heat, daily loss, monthly loss, concurrency, per-family and per-day counts. Software time-stops
cancel both OCO legs then market-sell, reconciled by client order ID and never retransmitted after an ambiguous response.

**Operations**: 15-minute cadence, LLM demoted to risk-trimming only (never blocks), `Flatten all` button, strategy leaderboard panel,
`scripts/backtest.js` walk-forward validator.

## Rollout (recommended)

1. Deploy. With `DEMO_ENGINE_EXECUTION` unset the engine only learns (paper). Settings migrate once (`multi-strategy-v4`, audited): orders/day 40,
   concurrent 4, max position 25% of capital, daily volume 600%, **risk per trade 0.5%**. Loss limits are never raised.
2. Run `node scripts/backtest.js --days 60` on your machine. Run again with `--slip 0.001`.
3. Watch the dashboard leaderboard for 3-7 days. Look for strategies with positive lower bound.
4. Set `DEMO_ENGINE_EXECUTION=true` and redeploy to a Preview first. Probes will trade at minimum size while evidence accumulates.
5. Keep `Flatten all` in mind. Review `engine.journal` for what the learner changed and why.

## Limits you should know about

* No real-market backtest could be run in the build sandbox (Binance unreachable). Synthetic tests prove correctness, not profitability.
* Demo fills are kinder than live fills. Expect live results to be worse.
* `capital` is $100 in your state. At that size profits are cents; percentage performance is what matters, and fees are a large share.
* GitHub as a database will grow ~4x faster at 15-minute cycles. Plan a move to Redis/Postgres or prune `runs/`.
* Spot is long-only: in a falling market the correct output is mostly "no trade".
