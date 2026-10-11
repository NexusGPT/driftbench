# Reader cases

A small Claude Code estate written by hand for the reader's tests. Each part holds one shape the reader once
missed on a real estate. Northwind Traders, its carriers and its checks are invented. Fictional data only.

| Gap | Where |
|---|---|
| 1. Symbolic links | `skills/parcel-claims/scripts` is a link to the shipment tracker's scripts folder; `parcel-claims/references/supplier-languages.md` is a link to a memory file. |
| 2. Registry tables of any column set | `guards/CHECK-REGISTRY.md`: a table with a guard column, and a table keyed by check id with an adapter and a fires-when column. W2 names its guard only through the script that holds its id; C2 through the catalogue. |
| 3. Step lists in a processes map | `processes.json`: `claim` and `month-close`. |
| 4. A catalogue of checks | `guards/catalogue.json`: C1 enforce, C2 observe, C3 off. |
| 5. A guard behind a prefix and a dispatcher | The Stop guard in `settings.json`: a shell test, an assignment, then `lib/dispatch.py claim-window.py`. |
| 6. Frontmatter the strict YAML parser refuses | `parcel-claims/SKILL.md`: a description holding a colon. |
| 7. Markdown beside a skill as prose | `parcel-claims/references/claim-rules.md`. |
| 8. Files no runtime loads | a test fixture, a pycache file, a log, a test under hooks and a node_modules file (skipped by default), and a synced skill copy (skipped by `driftbench.estate.yaml`). |
| 9. Paths named from another base | the last line of `CLAUDE.md` names `guards/CHECK-REGISTRY.md` (under `.claude/`) and `parcel-claims/references/claim-rules.md` (under `.claude/skills/`). |
| 10. Several ids in one registry cell | the rows `` `W4` `W5` `` and `` HANDBACK` / `STOP-WAKE ``; `claim-window.py` holds the last two ids. |

`answers.yaml` holds the model's part, written by the reader lane under the answer contract. `map.yaml` is
the scan with those answers; `approved.yaml` is that map with every atom approved. Made with:

```
pnpm driftbench estate scan examples/estates/reader-cases --runtime claude-code \
  --replay examples/estates/reader-cases/answers.yaml --out examples/estates/reader-cases/map.yaml
pnpm driftbench estate approve examples/estates/reader-cases/map.yaml --all \
  --to examples/estates/reader-cases/approved.yaml
```
