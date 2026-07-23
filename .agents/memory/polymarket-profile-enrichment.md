---
name: Polymarket profile enrichment condition
description: When to trigger the gamma public-profile lookup for name/pseudonym/profileImage/verifiedBadge fallback
---

Polymarket's Data API trade/activity payloads almost always already carry `name` and `pseudonym` for a wallet, but they very rarely carry `profileImage` or `verifiedBadge` — those two fields effectively only come from the gamma `/public-profile?address=` endpoint.

**Why:** An earlier version of the enrichment logic only called the public-profile fallback when a trade was missing *both* `name` and `pseudonym`. Since those two are almost always present, the fallback branch rarely ran in practice, and avatars/verified badges silently never appeared even though the endpoint and cache worked correctly. It looked like a wiring bug but was actually a wrong trigger condition.

**How to apply:** Key the enrichment condition on whichever field you actually need. If the goal is populating `profileImage`/`verifiedBadge`, fetch the profile whenever `profileImage` is missing — not only when `name`/`pseudonym` are missing. Do this per-endpoint (whale feed top-N, whale stats top wallets, single wallet profile) since each has its own enrichment site in `artifacts/api-server/src/routes/polymarket.ts`.
