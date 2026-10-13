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
| 11. Bare file names | `shipment-tracker` names `claim-rules.md`, which one file has; it also names `notes.md`, which two files have: its own references folder wins before the other skill. |
| 12. Path aliases | `.claude/ALIASES.md` maps `REF` to the parcel-claims references; `parcel-claims` names `REF/notes.md`. |
| 13. More default ignores and the recorded list | a `.trash` skill and the synced copy are skipped by default; `driftbench.estate.yaml` adds `archive`, which the map records for lint. |
| 14. Paths outside the estate | the last line of `CLAUDE.md` names a workspace file (`companies/`, an external folder of `driftbench.estate.yaml`), `_meta/IDENTITY.md`, `docs/DESIGN.md` and `~/notes/claims.md`: four EXTERNAL paths, counted as information. |
| 15. Bench defects | a copy of `claim-rules.md` under `guards/tests/fixtures` (a skipped file is never a name candidate, D2); an `env` key and the settings guards (JSON deletes, D5); registry rows naming their adapter by a short name (`claim-window`, `force-push`) and an id cell of backticked ids among words (D9). |

`answers.yaml` holds the model's part, written by the reader lane under the answer contract. `map.yaml` is
the scan with those answers; `approved.yaml` is that map with every atom approved. Made with:

```
pnpm driftbench estate scan examples/estates/reader-cases --runtime claude-code \
  --replay examples/estates/reader-cases/answers.yaml --out examples/estates/reader-cases/map.yaml
pnpm driftbench estate approve examples/estates/reader-cases/map.yaml --all \
  --to examples/estates/reader-cases/approved.yaml
```

Timing the reader at the size of a real estate: `node examples/estates/reader-cases/tools/make-large.mjs <empty folder> [skills] [megabytes]` writes reader-cases plus many job skills (1,200 by default, about 6,700 atoms) and about 100 MB of files no runtime loads. The output is never committed.
