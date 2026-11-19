# AI Trading Agent V1.0

A private Binance Demo Spot dashboard and research system. It tracks an allocated portfolio separately from the exchange wallet. The market, news, strategy, risk, learning and general manager agents have separate journal entries. The light dashboard includes interactive charts, a research office, daily reports and Demo QA status. Only the deterministic server-side execution code has access to the narrowly scoped order adapter.

## Run and release

Run `npm ci` followed by `npm test`. The suite uses isolated service fixtures and does not place orders or incur OpenAI charges. The Vercel build checks OpenAI model availability, publisher feed access and GitHub data read/write. It prints statuses only and blocks production on failure. The protected regional runtime check verifies Binance Demo market data, signed Spot access and the non-executing Demo test-order endpoint.

See [setup and operations](SETUP.md) and [Demo execution and reconciliation](DEMO-SETUP.md).
