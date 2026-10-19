# links2 blind pilot

## Cause table (seeds 1,2,3: 44 items, 8 failing)
All 8 ids: links2/localize/stale-link-passing-block/{1,3}/{first,last} and links2/localize/stale-spec-wide-link/{1,3}/{first,last}.
Product behaviour: localizeRows counts a `stale` link toward n_cf, n_cs and the linked count (only `refuted` is left out).
Doc: "A `refuted` or `stale` link adds nothing to `n_cf`, `n_cs` or the linked count of its section."
Fix: packages/core/src/radius/localize.ts:175 add `link.status !== 'stale'`.
Distinct causes: 1

## Rounds
| Round | Fix | Seeds 1,2,3 before/after | Seeds 977,4242 before/after | Commit |
|---|---|---|---|---|
| 1 | localize leaves stale links out | 8 / 0 | not run before (unknown seeds) / 0 | effbda1a2 |

Tests: pnpm vitest run --maxWorkers=2 on localize.test.ts, radius-localize.test.ts, localize-edges.test.ts: 3 files, 14 tests passed.

blind pilot: pass 8 fixed in round 1, 1 round, residual 0
cause review: 1 causes
