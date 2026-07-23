---
name: Orval null param serialization
description: Orval-generated URL builders serialize null query params as the string "null", not empty — this breaks server-side filters that check for truthy values.
---

## Rule
Never pass `null` for optional Orval query params — use `undefined` to omit them, or spread conditionally.

**Why:** The Orval-generated `getGetXxxUrl` function checks `value !== undefined` before appending, but then does `value === null ? 'null' : value.toString()`. So `null` becomes the literal string `"null"` in the URL. A server-side `if (search)` check then sees `"null"` as truthy, applies a filter for the word "null", and returns zero results.

**How to apply:** When building params for a hook call:
```ts
// WRONG — search=null, tag=null appear as "null" string
useGetPolyEvents({ limit: 100, search: null, tag: null })

// CORRECT — null-valued params are omitted from the URL
const params = {
  limit: 100,
  ...(searchVal !== undefined && { search: searchVal }),
  ...(tagVal !== undefined && { tag: tagVal }),
};
useGetPolyEvents(params)
```
Or pass `undefined` directly:
```ts
useGetTraderLeaderboard({ timePeriod: period, category: category !== "All" ? category : undefined })
```
