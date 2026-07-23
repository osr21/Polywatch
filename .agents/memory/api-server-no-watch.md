---
name: api-server has no dev file watcher
description: The PolyWatch api-server dev script builds once and runs the bundle — it does not hot-reload on file changes.
---

`artifacts/api-server`'s `dev` script is `build && start` (esbuild bundle, then `node dist/index.mjs`) — there is no watch mode. Unlike the Vite frontend (which HMRs automatically), backend route/logic changes require an explicit workflow restart before they take effect.

**Why:** After adding a new route or editing handler logic, curling the endpoint from bash without restarting the workflow returns a stale response (e.g. "Cannot GET /new-route") even though the source file is correct and typechecks — easy to misdiagnose as a routing/typo bug.

**How to apply:** After any change under `artifacts/api-server/src/**`, restart the `API Server` workflow before testing via curl or the browser.
