---
name: React Query must be peerDependency in api-client-react lib
description: Having @tanstack/react-query as a dependency (not peerDependency) in lib/api-client-react causes Vite to load two separate instances, breaking React context and producing "Invalid hook call" errors.
---

**Rule:** `lib/api-client-react/package.json` must declare `@tanstack/react-query` as a `peerDependency`, never as a `dependency`.

**Why:** If it's in `dependencies`, pnpm installs a copy inside `lib/api-client-react/node_modules`. Vite then resolves two separate module instances — one for the lib, one for the app. Since React Query stores its QueryClient in React context, using two instances means the app's QueryClientProvider and the lib's `useQuery` are in different React trees, causing:
```
Cannot read properties of null (reading 'useContext')
Invalid hook call
```

**How to apply:**
1. In `lib/api-client-react/package.json`: `"peerDependencies": { "@tanstack/react-query": ">=5", "react": ">=18" }` — no `dependencies` key.
2. In `artifacts/<slug>/vite.config.ts`: add `"@tanstack/react-query"` to `resolve.dedupe` alongside `"react"` and `"react-dom"`.
