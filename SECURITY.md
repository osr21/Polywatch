# Security Policy

## Supported versions

PolyWatch is a personal dashboard project maintained on a best-effort basis. Security fixes are applied to the `main` branch.

| Branch | Supported |
|--------|-----------|
| `main` | ✅ |

---

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, email the maintainer directly or open a [GitHub Security Advisory](https://github.com/osr21/Polywatch/security/advisories/new) (private disclosure).

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept
- Any suggested mitigations

You can expect an acknowledgement within 72 hours and a fix or response within 14 days.

---

## Security model

PolyWatch is a **single-owner dashboard**. It has no user authentication system. The threat model assumes:

- The API server is accessible from the internet (Replit public URL)
- All read-only GET routes are intentionally public (market data, whale feed, wallet profiles)
- Fund-risk and mutating routes are protected by a shared `ADMIN_TOKEN` secret

### What is protected

| Concern | Mitigation |
|---|---|
| Admin token brute-force | `timingSafeEqual` (SHA-256 digest, constant-time) |
| CORS bypass | Exact-match allow-list — no `origin.includes()` |
| Request flooding / DoS | `express-rate-limit` — 300 req / 15 min per IP |
| Large body attacks | 100 KB JSON body cap |
| Path injection on conditionId routes | `CONDITION_ID_RE = /^0x[0-9a-fA-F]{40,64}$/` on all `:conditionId` params |
| Clickjacking / MIME sniffing | `helmet` (X-Frame-Options, X-Content-Type-Options, HSTS) |
| Secret exposure in logs | Pino serializer strips bodies; secrets never logged |
| Private key in responses | `/settings/status` returns `{ set: true }` only — no key material |

### Known accepted risks

| Risk | Reasoning |
|---|---|
| `elliptic@6.6.1` — risky crypto primitive | No upstream fix; our usage follows safe ECDSA patterns via ethers.js; not directly callable by attackers |
| CLOB auth blocked by Cloudflare on cloud IPs | Expected behavior — authenticated endpoints degrade gracefully; not a vulnerability |

---

## Environment variables and secrets

- `POLY_PRIVATE_KEY` is held **in memory only** at runtime, never written to disk or returned in API responses.
- `ADMIN_TOKEN` is never logged and never returned in API responses.
- All secrets must be provided via environment variables (or a secrets manager). Never commit `.env` files.

---

## Dependency management

Vulnerable transitive dependencies are pinned via `pnpm.overrides` in the root `package.json`. The project runs `pnpm audit` as part of the security review process.
