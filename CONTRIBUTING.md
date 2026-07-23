# Contributing to PolyWatch

Thank you for your interest in contributing! PolyWatch is a personal analytics dashboard for Polymarket, and contributions are welcome for bug fixes, new features, and documentation improvements.

---

## Development setup

```bash
git clone https://github.com/osr21/Polywatch.git
cd Polywatch
pnpm install
```

Copy the example env file and fill in at minimum `SESSION_SECRET` and `ADMIN_TOKEN`:

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
```

Start both services:

```bash
# API server
pnpm --filter @workspace/api-server run dev

# Frontend (in a separate terminal)
pnpm --filter @workspace/polywatch run dev
```

---

## Project structure

```
artifacts/api-server/src/routes/polymarket.ts   ← all API logic
artifacts/polywatch/src/pages/                  ← one file per page
lib/api-spec/openapi.yaml                       ← OpenAPI contract
lib/api-client-react/src/generated/             ← DO NOT EDIT (generated)
lib/api-zod/src/generated/                      ← DO NOT EDIT (generated)
```

---

## Workflow

1. **Fork** the repo and create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **Make your changes.** Follow the conventions below.

3. **Typecheck** before pushing:
   ```bash
   pnpm run typecheck
   ```

4. **Open a pull request** against `main`. Fill in the PR template.

---

## Conventions

### API changes

1. **Edit `lib/api-spec/openapi.yaml` first** — it is the source of truth.
2. Run codegen after any spec change:
   ```bash
   pnpm --filter @workspace/api-spec run codegen
   ```
3. Never edit files under `lib/api-client-react/src/generated/` or `lib/api-zod/src/generated/` manually.
4. Do not add both path params AND query params to the same endpoint — Orval generates duplicate `*Params` types (TS2308).
5. New mutating/fund-risk routes **must** be wrapped with `requireAdmin`. Read-only GETs stay public.
6. All `/:conditionId` routes must validate against `CONDITION_ID_RE = /^0x[0-9a-fA-F]{40,64}$/`.

### Backend changes

- After editing `artifacts/api-server/src/`, restart the `API Server` workflow (it builds once then runs the bundle — there is no file watcher).
- Do not return raw `err.message` from upstream APIs on public endpoints. Return a generic error string.
- Never log secrets, private keys, or API keys. The Pino serializer already strips request bodies.

### Frontend changes

- Pages live in `artifacts/polywatch/src/pages/`. One file per route.
- Use the Orval-generated hooks from `lib/api-client-react` — do not write raw `fetch()` calls for endpoints that exist in the spec.
- For `fetch()` calls that do need an admin token, use `adminAuthHeaders()` from `artifacts/polywatch/src/lib/auth.ts`.
- Pass `undefined` (not `null`) for optional Orval hook params — `null` serializes to the string `"null"` in the URL.

### TypeScript

- Strict mode is on. Do not use `any` unless unavoidable; use `unknown` and narrow.
- Run `pnpm run typecheck` and fix all errors before opening a PR.

---

## Security

If you find a security vulnerability, please follow the process in [SECURITY.md](SECURITY.md). Do not open a public issue for security bugs.

---

## Code of conduct

Be respectful. This is a small personal project — keep discussion focused and constructive.
