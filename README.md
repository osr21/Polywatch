# 🐋 PolyWatch — Polymarket Whale Tracker

> **Real-time intelligence dashboard for Polymarket** — track large-money bets, detect potential insider activity, explore prediction markets, and monitor trader performance.

![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)
![Node](https://img.shields.io/badge/Node.js-24-green?logo=node.js)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react)
![Vite](https://img.shields.io/badge/Vite-7-646cff?logo=vite)
![License](https://img.shields.io/badge/license-MIT-green)

---

## What is PolyWatch?

PolyWatch is a single-owner analytics dashboard that wraps Polymarket's public APIs in a clean, real-time UI. It is designed to help you:

- **Spot whale trades** — filter the live trade stream by USDC size and see who's moving real money
- **Assess insider risk** — a composite risk score flags new wallets making concentrated large bets
- **Deep-dive any wallet** — full trade history, open positions, winnings summary, and profile enrichment
- **Track trader P&L** — leaderboard with podium display, time-period filters, and category breakdowns
- **Explore prediction markets** — browse live events, search markets, view order books and price charts
- **Monitor your builder stats** — fee revenue, tier status, and volume charts for your builder code
- **Watch perpetuals** — instruments table and trade feed (when API access is available)

---

## Features

| Feature | Description |
|---|---|
| **Whale Feed** | Live stream of large-USDC trades, auto-refreshing every 15s, sorted by size |
| **Insider Risk Score** | 0–100 composite score (wallet age × trade size × concentration) |
| **Wallet Deep Dive** | Avatar, verified badge, age, volume, risk gauge, trade history, open positions |
| **Markets Explorer** | Browse active markets with whale trades, order book, price chart, holders, and comments |
| **Events Explorer** | Browse Polymarket event containers with child markets, volume, category filters |
| **Trader Leaderboard** | P&L rankings with podium top-3, time-period & category selectors |
| **Perpetuals Tracker** | Instruments table + trade feed (early access) |
| **Builder Leaderboard** | Builder code volume stats, fee revenue, tier inference, 30d chart |
| **Liquidity Rewards** | Active reward-eligible markets table + taker rebate tier card |
| **Redeemable Winnings** | Read-only summary of resolved winning positions (links to redeem on polymarket.com) |

---

## Screenshots

> *(Add screenshots to `/docs/screenshots/` and reference them here)*

---

## Architecture

```
polywatch/                     ← pnpm monorepo
├── artifacts/
│   ├── api-server/            ← Express 5 API (Node.js 24)
│   │   └── src/routes/
│   │       └── polymarket.ts  ← All proxy + enrichment logic (~3300 lines)
│   └── polywatch/             ← React + Vite frontend
│       └── src/pages/         ← One file per route/page
├── lib/
│   ├── api-spec/
│   │   └── openapi.yaml       ← OpenAPI 3 contract (source of truth)
│   ├── api-client-react/      ← Orval-generated React Query hooks (do not edit)
│   └── api-zod/               ← Orval-generated Zod schemas (do not edit)
└── pnpm-workspace.yaml
```

### Key design decisions

- **No database** — all data is fetched live from Polymarket's public APIs. No auth required for read operations.
- **Code-generated API layer** — `lib/api-spec/openapi.yaml` is the single source of truth; Orval generates typed React Query hooks and Zod validators from it.
- **Admin-token gating** — fund-risk routes (order placement, cancellation, credential re-derivation) are gated behind a shared `ADMIN_TOKEN` secret checked via `requireAdmin` middleware. All GET routes are public.
- **Whale detection** — trades are filtered by `usdcSize ≥ minSize` (default $1,000). Falls back to `size × price` when `usdcSize` is absent from the payload.
- **Risk scoring** — composite of wallet age (new = high risk), average trade size, and trade concentration. Thresholds: LOW < 25, MEDIUM < 50, HIGH < 75, CRITICAL ≥ 75.
- **Insider enrichment** — top 25 unique wallets on the feed are enriched with age and Gamma profile data (avatar, verified badge) without hammering rate limits.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 24, pnpm workspaces |
| Language | TypeScript 5.9 (strict) |
| Frontend | React 19, Vite 7, Tailwind CSS v4 |
| Backend | Express 5, esbuild bundle |
| API contract | OpenAPI 3 → Orval (React Query + Zod) |
| Security | helmet, cors (exact-match allow-list), express-rate-limit, timingSafeEqual admin auth |
| Logging | pino + pino-http |

---

## Setup

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`npm i -g pnpm`)

### Install

```bash
git clone https://github.com/osr21/Polywatch.git
cd Polywatch
pnpm install
```

### Environment variables

Create a `.env` file in `artifacts/api-server/` (or set via your platform's secrets manager):

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | Yes | Minimum 32-char random string for session signing |
| `ADMIN_TOKEN` | Yes | Bearer token for fund-risk / mutating routes |
| `POLY_BUILDER_CODE` | Optional | Your Polymarket builder code (shows builder leaderboard stats) |
| `POLY_ADDRESS` | Optional | Your wallet address (enables portfolio/positions pages) |
| `POLY_PRIVATE_KEY` | Optional | EVM private key for CLOB L2 auth (order placement, rewards) |
| `POLY_API_KEY` | Optional | Pre-derived CLOB API key (used as fallback if private key present) |
| `POLY_API_SECRET` | Optional | CLOB API secret |
| `POLY_API_PASSPHRASE` | Optional | CLOB API passphrase |
| `CLOB_PROXY_URL` | Optional | CLOB proxy wallet address (from Polymarket Settings → Builder tab) |
| `RELAYER_API_KEY` | Optional | Relayer API key for Polymarket |

> ⚠️ **Never commit `.env` to version control.** `POLY_PRIVATE_KEY` controls real funds.

### Run (development)

```bash
# Terminal 1 — API server (rebuilds on workflow restart)
pnpm --filter @workspace/api-server run dev

# Terminal 2 — Frontend (HMR)
pnpm --filter @workspace/polywatch run dev
```

### Typecheck & build

```bash
pnpm run typecheck     # full type-check across all packages
pnpm run build         # typecheck + production build
```

### Regenerate API client (after editing openapi.yaml)

```bash
pnpm --filter @workspace/api-spec run codegen
```

---

## API Overview

All endpoints are under `/api`. GET routes are public. POST/DELETE routes that affect funds require `Authorization: Bearer <ADMIN_TOKEN>`.

### Read-only endpoints (public)

| Method | Path | Description |
|---|---|---|
| GET | `/markets` | Browse active prediction markets |
| GET | `/markets/:conditionId/orderbook` | Live order book for a market |
| GET | `/markets/:conditionId/whales` | Recent whale trades for a market |
| GET | `/markets/:conditionId/holders` | Top YES/NO token holders |
| GET | `/markets/:conditionId/comments` | Community comments |
| GET | `/market-price-history` | Price history per outcome token |
| GET | `/whales/trades` | Global whale trade feed |
| GET | `/events` | Polymarket event containers |
| GET | `/trader-leaderboard` | Trader P&L rankings |
| GET | `/perps/instruments` | Perpetuals instruments |
| GET | `/perps/trades` | Perpetuals trade feed |
| GET | `/rewards/markets` | Reward-eligible markets |
| GET | `/builder/leaderboard` | Builder code rankings |
| GET | `/wallet/:address` | Wallet profile + risk score |
| GET | `/wallet/:address/trades` | Wallet trade history |
| GET | `/wallet/:address/positions` | Wallet open positions |
| GET | `/settings/status` | Account/integration status (no secrets returned) |

### Admin-gated endpoints (`Authorization: Bearer <ADMIN_TOKEN>` required)

| Method | Path | Description |
|---|---|---|
| POST | `/ai/signals` | AI trade signal analysis |
| POST | `/auth/derive` | Re-derive CLOB credentials from private key |
| POST | `/bot/config` | Configure auto-trading bot |
| POST | `/bot/execute` | Execute bot trade |
| DELETE | `/orders` | Cancel all open orders |
| DELETE | `/orders/:orderId` | Cancel a specific order |

---

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure policy.

Hardening applied:
- CORS exact-match allow-list (no `origin.includes()` bypass)
- `express-rate-limit` global (300 req / 15 min per IP)
- `helmet` with HSTS, X-Frame-Options, X-Content-Type-Options
- `timingSafeEqual` admin token comparison (timing-attack resistant)
- `CONDITION_ID_RE` validation on all `/:conditionId` routes
- 100 KB request body cap
- All secrets via environment variables only — never in code or logs

---

## Known Limitations

- **Authenticated CLOB routes** (rewards, orders) are blocked by Cloudflare's Bot Fight Mode on hosted/cloud IPs. They work fine from a residential or VPS IP.
- **Perpetuals API** (`api.perpetuals.polymarket.com`) is early access and not publicly reachable yet. The page renders a graceful empty state.
- **Wallet age** requires fetching up to 500 trades per wallet; only the top 25 unique wallets on the feed are enriched per refresh to stay within rate limits.
- **Position redemption** is intentionally read-only — signing a Safe meta-transaction against Polymarket's adapter contract requires the private key and is not implemented. The UI links out to polymarket.com/portfolio.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](LICENSE).
