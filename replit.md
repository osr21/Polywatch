# PolyWatch

A real-time Polymarket whale wallet tracking dashboard — spot large-money bets and detect potential insider trading activity across prediction markets.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/polywatch run dev` — run the frontend (port 20909)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS (dark terminal aesthetic)
- API: Express 5 (proxying Polymarket public APIs)
- No database — all data sourced from Polymarket public APIs (no auth required)
- Validation: Zod, drizzle-zod
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — generated Zod validation schemas (do not edit)
- `artifacts/api-server/src/routes/polymarket.ts` — all Polymarket proxy + enrichment logic
- `artifacts/polywatch/src/pages/` — frontend pages (feed, markets, wallet)
- `artifacts/polywatch/src/components/layout.tsx` — sidebar layout

## Architecture decisions

- **No database**: All data is fetched live from Polymarket's public Data API (`data-api.polymarket.com`) and Gamma API (`gamma-api.polymarket.com`). No API keys required.
- **Whale detection**: Trades are filtered by `usdcSize >= minSize` (default $1,000). The `usdcSize` field is the actual USDC value of each trade.
- **Wallet age**: Determined by fetching the wallet's full trade history and finding the earliest timestamp. Age = (now - firstTrade) / 86400 days.
- **Insider risk score (0-100)**: Composite of wallet age (new wallets score higher), average trade size (larger = higher), and trade concentration (few trades + large size = suspicious). Thresholds: LOW < 25, MEDIUM < 50, HIGH < 75, CRITICAL = 75+.
- **@tanstack/react-query as peerDependency**: `lib/api-client-react` declares React Query as a peerDependency to avoid Vite loading two instances (which breaks the React context and causes "Invalid hook call" errors).
- **Admin-token gating on fund-risk routes**: This app has no login system (single-owner dashboard), so `artifacts/api-server/src/app.ts` mounts no global auth — every `/api` route is otherwise publicly callable. Routes that can move real funds or change trading behavior (`POST /bot/config`, `POST /bot/execute`, `DELETE /bot/log`, `DELETE /orders`, `DELETE /orders/:orderId`, `POST /auth/derive`) are individually wrapped with `requireAdmin` (`artifacts/api-server/src/middlewares/requireAdmin.ts`), which checks `Authorization: Bearer <ADMIN_TOKEN>` and fails closed (503) if the secret isn't configured. All GET routes stay public by design. The frontend owner unlocks trading once per browser via the sidebar control (`artifacts/polywatch/src/components/admin-unlock.tsx`), which stores the token in `localStorage` and wires it in via `setAuthTokenGetter` (`artifacts/polywatch/src/App.tsx`) for Orval-generated hooks, plus manual `adminAuthHeaders()` for the two raw `fetch()` calls in `portfolio.tsx`. A `HARD_MAX_TRADE_USDC` server-side cap ($2000) also bounds any single order regardless of client-supplied config.

## Product

- **Whale Feed** (`/`) — Live stream of large-USDC trades on Polymarket, sorted by size. Each card shows market name, outcome, wallet address + avatar/verified badge (when Polymarket has one on file), wallet age, risk score, and USDC value. Auto-refreshes every 15 seconds.
- **Markets Explorer** (`/markets`) — Browse active Polymarket markets with liquidity info. Click any market to view its whale trades in a drawer.
- **Wallet Deep Dive** (`/wallet/:address`) — Full wallet profile: avatar/verified badge, age in days, total volume traded, risk score gauge, risk label (LOW/MEDIUM/HIGH/CRITICAL), risk factors, trade history, and open positions. Reachable by clicking any wallet address on the feed.
- **Wallet Search** — Search bar accepts any `0x...` address and navigates to its profile.
- **Builder Leaderboard** (`/leaderboard`) — Top builder codes by volume (DAY/WEEK/MONTH/ALL), verified badges + logos, a 30-day volume chart and a trade-history drawer for the locally configured `POLY_BUILDER_CODE`. Also shows:
  - **Builder tier status** — best-effort inference (no public tier API exists): if the builder code appears on the ALL-time leaderboard it's inferred Verified+; otherwise "tier unconfirmed" with a link to check on polymarket.com.
  - **Builder fee revenue** — sums `feeUsdc` across the builder's trades (bounded pagination, marks `truncated` if not all trades were scanned) and shows a FEE column in the trade-history drawer.
- **Liquidity Rewards** (`/rewards`) — Personal reward rates + earnings (via authenticated CLOB calls — best-effort, see Gotchas) and a public table of all active reward-eligible markets with per-market rate/spread/min-size details.
- **Redeemable Winnings** (on Wallet Deep Dive, Open Positions tab) — read-only summary card totaling `currentValue` of resolved positions worth redeeming (`redeemable === true && currentValue > 0`), plus a link to redeem on polymarket.com/portfolio. Intentionally read-only this pass — see Gotchas for why.

## Gotchas

- Polymarket's `trades` endpoint does not always include `usdcSize` — the server falls back to `size * price` if the field is missing.
- Wallet age lookup requires fetching up to 500 trades per wallet; only the top 25 unique wallets on the whale feed get age-enriched to avoid rate limits.
- The `@tanstack/react-query` must be in `peerDependencies` (not `dependencies`) in `lib/api-client-react/package.json`, and must be in `dedupe` in `vite.config.ts`. Violating either causes silent "Invalid hook call" errors.
- After any OpenAPI spec change, always run `pnpm --filter @workspace/api-spec run codegen` before using updated types.
- Avoid adding both path params AND query params to the same endpoint in the OpenAPI spec — Orval generates duplicate `*Params` types that cause TS2308 collisions.
- Data API trade payloads almost always carry `name`/`pseudonym` but rarely carry `profileImage`/`verifiedBadge` — enrich from the gamma public-profile endpoint whenever the avatar is missing, not just when name/pseudonym are missing (see `artifacts/api-server/src/lib/profiles.ts`).
- Authenticated CLOB endpoints (`/rewards/user/*`, `/orders`, etc.) are blocked by Cloudflare from this hosted environment and return 401/502 — the Rewards page shows a graceful notice for these instead of failing hard; the public `/rewards/markets` table is unaffected.
- Position `redeemable === true` only means the market has resolved and the position is eligible for on-chain redemption — it does NOT mean the position won. Losing positions are also `redeemable: true` but with `currentValue: 0`. Always gate "redeemable winnings" UI on `redeemable === true && currentValue > 0`.
- Actual redemption requires signing a Safe/Proxy meta-transaction against Polymarket's adapter contract — deliberately NOT implemented (real funds at stake, adapter address/ABI unconfirmed). The Redeemable Winnings card is read-only; it links out to polymarket.com/portfolio for the actual redeem action.
- The frontend must read `POLY_BUILDER_CODE` via `GET /api/settings/status` (`builderCode.value`), not a `VITE_BUILDER_CODE` build-time env var — no such var is ever set, so anything gated on it silently never renders. Use the shared `useAccountStatus()` hook (`artifacts/polywatch/src/lib/useAccountStatus.ts`).
- `artifacts/api-server` has no dev-mode file watcher (`pnpm run dev` builds once then runs the bundle) — after backend route changes, restart the `API Server` workflow before curling new endpoints, or you'll see stale "Cannot GET" 404s.
- Any new mutating route in `polymarket.ts` that can spend funds, place/cancel orders, or change credentials/config must be wrapped with `requireAdmin` — it is NOT applied globally, so it's easy to forget on a newly added route. Read-only GETs should stay public.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
