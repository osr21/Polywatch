---
name: Security hardening decisions
description: Security fixes applied to the PolyWatch API server — CORS, rate limiting, auth, input validation, and dependency overrides.
---

## CORS exact-match fix
**Rule:** Never use `origin.includes(domain)` for CORS allow-list — use exact match `origin === "https://${d}"`.
**Why:** `origin.includes("myapp.replit.app")` is bypassable via `https://evil.com?myapp.replit.app`. Fixed in `app.ts` to use `origin === \`https://${d}\`` for the REPLIT_DOMAINS fallback.
**The regex** `/^https:\/\/[\w-]+\.(replit\.app|repl\.co|replit\.dev)(\/.*)?$/` already handles subdomains safely; the bug was only in the REPLIT_DOMAINS fallback.

## Rate limiting
**Rule:** `express-rate-limit` global limiter (300 req/15 min per IP) is in `app.ts`, skipping loopback. Expensive endpoints already have per-handler guards (AI signals has `checkAiRateLimit`).
**Why:** Without rate limiting, anyone with the API URL could DoS Polymarket's upstream APIs or exhaust AI credits.

## /ai/signals requires admin token
**Rule:** `router.post("/ai/signals", requireAdmin, ...)` — consumes Anthropic API credits; must be gated.
**Why:** POST to `/ai/signals` was public, allowing anyone to hammer Anthropic API.

## conditionId validation — CONDITION_ID_RE
**Rule:** All `/:conditionId` routes and `/market-price-history?conditionId=` must validate against `CONDITION_ID_RE = /^0x[0-9a-fA-F]{40,64}$/`.
**Why:** Prior check was `conditionId.length < 10` which allows arbitrary strings (injection via upstream URL). Applied to: orderbook, whales, holders, price-history, comments routes.

## pnpm overrides for transitive vulnerabilities
Applied in root `package.json` under `pnpm.overrides`:
- `axios >=1.9.0` (was 0.27.2 — prototype pollution, SSRF, credential theft)
- `ws >=8.21.0` (memory exhaustion DoS)
- `fast-uri >=3.1.4` (host confusion)
- `linkify-it >=5.0.2` (ReDoS)
- `js-yaml >=4.3.0` (quadratic DoS)
- `qs >=6.15.2` (DoS via stringify crash)
- `brace-expansion >=5.0.7` (exponential expansion DoS)
- `markdown-it >=14.2.0` (quadratic complexity DoS)
- `body-parser >=2.3.0` (DoS via invalid limit header)

## Accepted residual risk
- `elliptic@6.6.1` — no fix available; risky crypto primitive, but our usage (ECDSA via ethers.js) follows safe patterns; not directly invocable by attackers.
- `esbuild` dev server — only runs in `pnpm dev`; does not ship to production.
- `@babel/core` — build tool only; we compile trusted code.

## Private key status
`POLY_PRIVATE_KEY` is read from `process.env` at startup, stored in `runtimeCreds.privateKey` (in-memory only), never logged, never returned in any API response. `/settings/status` only returns `set: !!pk` (boolean). CLOB L2 headers are signed in-memory without exposing the key.
