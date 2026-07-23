---
name: Frontend access to server-only secret values
description: How to expose a value known only via a server env var to the frontend at runtime, in a workspace with no VITE_* var wired up.
---

When a value is set as a server-side secret/env var (e.g. `POLY_BUILDER_CODE`) and the frontend needs to know it (to gate a UI section, display it, etc.), do not introduce a `VITE_*` build-time env var for it unless one is already wired into the Vite config and actually populated in the deployment env.

**Why:** It's easy to write `import.meta.env.VITE_FOO ?? ""` and have it silently evaluate to `""` forever if no `VITE_FOO` is ever set anywhere (vite.config define, .env file, workflow env). The code typechecks and runs with no errors — the whole gated UI section just never renders, with no error to signal why. This is a hard bug to notice by testing UI alone, especially days later.

**How to apply:** Prefer exposing the value through an existing runtime status/config endpoint the server already serves (e.g. `/api/settings/status`), and fetch it client-side. If such an endpoint doesn't exist yet, add the field to it rather than inventing a parallel `VITE_*` var. Before trusting any `import.meta.env.VITE_*` reference, grep for where that var is actually set (vite `define`, `.env`, `artifact.toml` `[services.env]`) — if you can't find it, it's dead.
