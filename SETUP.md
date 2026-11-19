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

The dashboard signs in using the existing administrator password. Sessions expire after 45 minutes. The dashboard reads every 20 seconds while visible. Sign-in limits and mutation controls apply across instances, with additional instance-local request rate limits.

## Data and schedule

The platform reads its starting configuration from `config/defaults.json` and checks the legacy journal in `journal/events.json`. It keeps the original files and persists V1 state, authenticated session digests, immutable research cycles and administrator changes under separate `v1/preview` and `v1/production` prefixes. Back up the private repository and prefer a dedicated Binance Demo wallet. A GitHub outage can make sign-in, operations or journal viewing unavailable.

Vercel runs daily research and performance review at 04:00 UTC (08:00 Gulf Standard Time), subject to the scheduled execution window. Administrators can also run research on demand. A shared lease blocks overlapping cycles. The daily scheduler deduplicates deliveries and the review runs at most once per local day after a successful review. If a function terminates prematurely, the lease expires four minutes after acquisition and any pending order remains blocked for reconciliation.

AI opinion requests reserve estimated cost before sending. Timeouts and unconfirmed usage remain charged at the reserved maximum. The dashboard displays application estimates and tracks requests and tokens locally. Provider billing and requests made elsewhere are outside this application's budget. The CoinDesk publisher feed supplies attributed headlines, and the model summarizes headline sentiment. Backtests use closed Demo candles and next-bar opens with an estimated fee. Results are hypothetical and separate from executed P&L. Approval of a proposed strategy requires an administrator and is recorded in the audit trail.
