## Summary

<!-- What does this PR do? One paragraph. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Dependency update
- [ ] Refactor / cleanup

## Checklist

- [ ] `pnpm run typecheck` passes with no errors
- [ ] If the OpenAPI spec changed, `pnpm --filter @workspace/api-spec run codegen` was run and generated files are committed
- [ ] New mutating/fund-risk routes are wrapped with `requireAdmin`
- [ ] New `/:conditionId` routes validate against `CONDITION_ID_RE`
- [ ] No secrets, private keys, or API keys are logged or returned in API responses
- [ ] Backend changes: API Server workflow was restarted and the new endpoint was manually tested

## Test plan

<!-- How did you verify this works? What should a reviewer do to check it? -->

## Related issues

<!-- Closes #... -->
