# Fixture estate, version 2: the Northwind ops assistant after a change

The second version of the hand-written Northwind estate in `examples/estates/fixture/`, for the estate
maintenance commands (`driftbench estate diff` and `driftbench estate impact`). Northwind Traders, its
suppliers, its finance lead and its decision logs are invented. Nothing here comes from a real estate.

What changed from the first version:

| Change | Where | Class in the diff |
|---|---|---|
| R2 wrapped onto two lines, same words | `CLAUDE.md` | changed, white space only |
| R7: late after one day instead of two days | `CLAUDE.md` | changed, semantic |
| The route planner row: the next two days instead of tomorrow | `CLAUDE.md` routing table | changed, semantic |
| R12 (keep an unconfirmed draft unsent) removed and R19 (keep the credit note a draft until the finance lead answers) written at its place | `CLAUDE.md` | changed, semantic, under R12's id with R19's in `now`: the ledger keeps the unit, so a rule removed and another added at the same unit read as one changed rule; R19's edge to R18 is added |
| R18 (name the finance lead on a credit note above 500.00 EUR) added | `CLAUDE.md` | added |
| The ledger guard promoted from warn to enforce, with decision evidence | `guard-state.yaml` | guard promoted |

R2's wrap and the new rules shift lines, so 24 atoms move with the same quote; a move
touches no test, and neither does R2's wrap (white space only). The size invariant of the standing file is restated (its measured size changed).

Files:

- `CLAUDE.md`, `.claude/`: the estate, a copy of the first version with the changes above.
- `answers.yaml`: the recorded answers of the first version with the same changes, as a model would have
  copied the new text.
- `map.yaml`: the scan of this version.
- `guard-state.yaml`: the enforcement state of this version's guards, read against `map.yaml`.
- `maintain/guard-state.v1.yaml`: the enforcement state of the first version, read against
  `examples/estates/fixture/approved.yaml` (kept here because that folder belongs to another lane).
- `tests/`: eight version 1 tests, each naming its atoms under `metadata.estate.atoms`.
- `maintain/diff.json`, `maintain/diff.txt`: the diff of the first version against this one.
- `maintain/impact.json`, `maintain/impact.txt`: the impact of that diff on `tests/` (exit 1: two atoms
  wait for re-approval, two new atoms have no test, and R12's unit, which no atom covers, changed to R19 and
  waits for a person).
- `ledger.json`: the ledger of this version, written by the scan from the ledger of the first version; the diff
  reads both, so a changed unit no atom covers is still reported.

Made from the repository root with:

```
cp examples/estates/fixture/ledger.json examples/estates/fixture-v2/ledger.json
pnpm driftbench estate scan examples/estates/fixture-v2 --runtime claude-code --pointer \
  --cassette examples/estates/fixture-v2/cassette.jsonl --ledger examples/estates/fixture-v2/ledger.json --update \
  --out examples/estates/fixture-v2/map.yaml
pnpm driftbench estate diff examples/estates/fixture/approved.yaml examples/estates/fixture-v2/map.yaml \
  --old-guards examples/estates/fixture-v2/maintain/guard-state.v1.yaml \
  --old-ledger examples/estates/fixture/ledger.json --new-ledger examples/estates/fixture-v2/ledger.json \
  --out examples/estates/fixture-v2/maintain/diff.json > examples/estates/fixture-v2/maintain/diff.txt
pnpm driftbench estate impact examples/estates/fixture-v2/maintain/diff.json \
  --tests examples/estates/fixture-v2/tests \
  --out examples/estates/fixture-v2/maintain/impact.json > examples/estates/fixture-v2/maintain/impact.txt
```

The JSON files are then formatted by the repository's formatter; the tests compare them as data. No test
is retired: R12's two tests are regenerated and wait for re-approval. The committed tests are left as the
first version wrote them.
