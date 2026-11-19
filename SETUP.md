# Configuration and operations

## Vercel environment

Configure secrets separately in Preview and Production.

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD_HASH` | Administrator scrypt verifier, formatted as 32 lowercase hex salt characters, a colon, and a 64-character lowercase hex digest. The original administrator password stays with the administrator. |
| `SESSION_SECRET` | Random server-only session and CSRF signing secret. Changing it revokes existing sessions and Demo order verification. |
| `GITHUB_DATA_TOKEN` | Fine-grained token scoped to Contents read/write on the private `AliNSheikh/ai-trading-data` repository only. The token must be allowed to write the `main` branch there. |
| `BINANCE_DEMO_API_KEY`, `BINANCE_DEMO_API_SECRET` | HMAC credentials created in Binance Demo Trading, with Demo Spot account and trading access. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Server-only OpenAI project credentials and a model with a budget rate in `lib/ai.js`. The default model is `gpt-4o-mini`. |
| `CRON_SECRET` | Random secret for the scheduled production endpoint. Use at least 16 characters. |
| `DEMO_EXECUTION_ENABLED` | Production-only gate. Leave unset or `false` for read-only research. |
| `DEMO_AUTONOMOUS_ENABLED` | Enables the user-authorized fixed playbook and automatic re-verification when production is already armed. Emergency stop still takes precedence. |

The dashboard signs in using the existing administrator password. Sessions expire after 45 minutes. The dashboard reads every 20 seconds while visible. Sign-in limits and mutation controls apply across instances, with additional instance-local request rate limits.

## Data and schedule

The platform reads its starting configuration from `config/defaults.json` and checks the legacy journal in `journal/events.json`. It keeps the original files and persists V1 state, authenticated session digests, immutable research cycles and administrator changes under separate `v1/preview` and `v1/production` prefixes. Back up the private repository and prefer a dedicated Binance Demo wallet. A GitHub outage can make sign-in, operations or journal viewing unavailable.

Functions run in the Frankfurt region. To check all dependencies from the deployed function, send a GET to `/api/cron?verify=1` with the environment's `CRON_SECRET` as a Bearer header. Use Vercel-authenticated access for protected deployment URLs. The regional probe tests a non-executing Demo order and writes a GitHub verification receipt. It never runs research cycles or sends an order to the matching engine.

Vercel registers one daily trigger for each UTC hour. The production application deduplicates each hourly window and uses a shared lease to prevent overlap. On plans with per-hour scheduling precision, actual start times vary within the hour. Administrators can also request research on demand. Model training and performance review run at most once per successful Gulf Standard Time day. If a function terminates prematurely, the lease expires four minutes after acquisition and any pending order remains blocked for reconciliation.

Production runs the non-executing Demo QA campaign once per GST day through November 30, 2026, including the last local day. A degraded check retries after four hours while the campaign is active. Hourly research continues after the QA campaign ends. The test checks market data and filters for each configured pair, signed account and test-order access, OpenAI model availability, publisher feed availability, and GitHub read/write. Results appear under Reports. Preview runs an equivalent research cycle with the authorized GET probe `/api/cron?research=1`, without permitting filled orders.

AI opinion requests reserve estimated cost before sending. Saved limits allow up to 240 daily requests, with a hard 10 per GST hour and the existing monthly spending ceiling. Each release runs a three-case completion benchmark and records semantic accuracy, latency, tokens, and estimated cost. Timeouts and unconfirmed usage remain charged at the reserved maximum. The dashboard displays application estimates and tracks requests and tokens locally. Provider billing and requests made elsewhere are outside this application's budget. The CoinDesk publisher feed supplies attributed headlines, and the model summarizes headline sentiment. Backtests use closed Demo candles and next-bar opens with an estimated fee. Results are hypothetical and separate from executed P&L. Approval of a proposed strategy requires an administrator and is recorded in the audit trail. Production shows earlier Preview research in a separate archive under Research. Preview runs and fills stay outside the production portfolio.

The Learning Engineer trains a two-hidden-layer neural network on up to roughly one month of historical Demo candles per pair. It estimates whether a one-hour return exceeds estimated round-trip fees. A purged chronological split separates training, calibration, and holdout scores. For each of the four fixed rules, the release gate requires at least 20 nonoverlapping qualifying holdout signals, a conservative Wilson lower bound of 60% or greater, and positive mean net return. Authorized fixed playbook candidates are used automatically in autonomous mode; ad hoc strategy changes require administrator approval. Approval is bound to the active strategy and the artifact expires after 14 days. Error and loss summaries are tracked separately. Previously observed losing forecasts in the training split receive higher weight in the next model trial. The General Manager aggregates daily activity, failures, fills, and priorities.
