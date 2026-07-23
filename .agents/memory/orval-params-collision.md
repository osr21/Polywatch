---
name: Orval path+query param TS2308 collision
description: Orval generates duplicate *Params type names when an endpoint has both path params and query params, causing TS2308 typecheck failures after codegen.
---

When an OpenAPI endpoint has BOTH path parameters (e.g. `{address}`) AND query parameters (e.g. `limit`), Orval generates:
- A Zod schema named `GetWalletTradesParams` in `lib/api-zod/src/generated/api.ts`
- A TypeScript type named `GetWalletTradesParams` in `lib/api-zod/src/generated/types/getWalletTradesParams.ts`

Both are re-exported from `lib/api-zod/src/index.ts`, causing:
```
error TS2308: Module "./generated/api" has already exported a member named 'GetWalletTradesParams'
```

**Why:** Orval v8 generates both a Zod schema AND a TS interface for params when path+query params are combined. The barrel export in `lib/api-zod/src/index.ts` exports both, causing a name collision.

**How to apply:** When writing OpenAPI spec, remove query params from endpoints that already have path params. Hard-code default limits server-side. Only add query params to endpoints that have NO path params (e.g. list endpoints like `GET /whales` or `GET /markets`).
