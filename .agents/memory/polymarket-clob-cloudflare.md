---
name: Polymarket CLOB Cloudflare block
description: Polymarket's CLOB API blocks most endpoints from cloud server IPs via Cloudflare Bot Fight Mode
---

`clob.polymarket.com` is behind Cloudflare Bot Fight Mode. Most endpoints return a 404 HTML Cloudflare challenge page when called from cloud/server IPs (like Replit, AWS, GCP).

**Endpoints that pass through:** `/auth/api-key` (POST), `/auth/api-keys` (GET) — these return JSON 401 errors from Polymarket's backend.

**Endpoints that are blocked:** `/balance`, `/orders`, `/markets`, `/rewards/user/*`, and most other authenticated data endpoints. Blocking manifests two ways depending on the endpoint: either a Cloudflare 404 HTML challenge page, or a JSON `401 Unauthorized/Invalid api key` from Polymarket's own backend (seen on `/rewards/user/percentages` and `/rewards/user`) — both are the same underlying cloud-IP block, not a credentials problem.

**How to apply:** Do NOT use a live CLOB ping as a health check or settings test from the server. Instead, check that credentials are present and well-formed. The sidebar should show "READY" based on credential presence, not a live ping result. For any new authenticated CLOB route, treat both the HTML-challenge and JSON-401 failure modes as "blocked from this environment" and surface a best-effort/graceful notice in the UI rather than a hard error — do not assume a 401 means the configured credentials are actually wrong.

Adding `User-Agent: @polymarket/clob-client` does NOT bypass the Cloudflare block.

**Possible workaround found but not adopted (user declined):** Routing the request through a third-party scraping proxy (tested with Firecrawl's `/scrape` via the `external_apis` passthrough, `proxyUsed: "stealth"`) DOES appear to get past Cloudflare — a request with deliberately garbage `POLY_*` headers returned Polymarket's own JSON `{"error":"Unauthorized/Invalid api key"}` (401) instead of a Cloudflare challenge page, meaning the request reached Polymarket's app backend. Firecrawl's scrape endpoint passes through arbitrary custom request headers unchanged (verified against postman-echo.com), so it could in principle carry real L2 HMAC auth headers. This was not implemented because it requires sending live `POLY_API_KEY`/`POLY_PASSPHRASE`/signature through a third-party vendor on every call, which the user was asked about and declined (credential-exposure + per-call billing tradeoff). Note: Browserbase's `/v1/fetch` was tried first and does NOT support custom headers (it only does a plain browser navigation, confirmed by header echo test) — it is not viable for authenticated calls at all, regardless of the credential tradeoff.

If asked again in a future session to revisit authenticated CLOB access from this environment, this Firecrawl-proxy path is the known viable option — but re-confirm user consent before sending real credentials through it, and note the per-request billing cost.
