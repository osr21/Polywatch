---
name: Admin-token gating for single-owner apps with no login system
description: Pattern for protecting fund-risk/mutating routes in apps that intentionally have no user accounts
---

Some apps (personal trading dashboards, single-owner tools) intentionally have
no login/session system — every route is reachable by anyone who has the
preview/production URL. If any route can move real funds, place/cancel
orders, or rotate credentials, a full auth system is overkill but *some*
gate is mandatory.

**Pattern that worked well:**
- A single shared-secret middleware (checks `Authorization: Bearer <TOKEN>`
  against an env var via constant-time comparison, fails closed with 503 if
  the env var isn't set) applied *per-route* only to the mutating/fund-risk
  endpoints — not globally. Read-only GETs stay public.
- Defense in depth: also enforce an absolute server-side ceiling on any
  single trade/order amount, independent of client-supplied config values,
  in case the shared secret is ever leaked.
- On the frontend: wire the token into the generated API client's global
  auth-token-getter hook once at bootstrap (covers all generated-hook
  mutations automatically), but explicitly check for and patch any *raw*
  `fetch()` calls that bypass the generated client — they silently won't
  get the header otherwise.
- Give the owner a persistent, low-friction way to enter the token once per
  browser (e.g. a small unlock control in a persistent layout element),
  and surface 401s as an actionable toast rather than a generic failure.

**Why:** A production incident risk (e.g. an unauthenticated endpoint that
lets anyone flip on an auto-trading loop using the owner's real API keys)
is easy to miss because "no auth" is often *intentional* for the read-only
parts of these apps — the fix must be surgical, not a blanket login wall.

**How to apply:** When auditing or building single-owner apps with any
fund-moving, credential-rotating, or state-mutating capability, explicitly
enumerate every non-GET route and confirm each one is either safe to leave
public (pure analytics/read) or gated behind the shared-secret middleware.
