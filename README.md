# AI Trading Agent V1.0

A private Binance Demo Spot dashboard and research system. It tracks an allocated portfolio separately from the exchange wallet. The market, news, strategy, risk and learning agents have separate journal entries. Only the deterministic server-side execution code has access to the narrowly scoped order adapter.

## Run and release

Run `npm ci` followed by `npm test`. The suite uses isolated service fixtures and does not place orders or incur OpenAI charges. The Vercel build also checks Binance Demo market data, signed Spot access, the non-executing Demo test-order endpoint, OpenAI model availability, publisher feed access, and GitHub data read/write. It prints statuses only. Production builds fail when a required check fails.

See [setup and operations](SETUP.md) and [Demo execution and reconciliation](DEMO-SETUP.md).
