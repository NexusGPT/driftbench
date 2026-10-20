# H7 fresh sample, ledger selection: result

Pre-registration: `PREREG-ledger.md` (commit `d6a8ceede`). Marks frozen as at `81fb93054`, no rule changes. The 274 mutants and their recorded flips are those of PR 983; no model call, no new spend. Run once on 2026-10-20.

| | Ledger selection with the marks | Ledger selection without the marks | Section selection with the marks (PR 983) |
|---|---|---|---|
| Measured | 274 | 274 | 274 |
| Misses | 0 | 9 | 0 |
| Wilson 95% upper bound | 1.38% | 6.12% | 1.38% |
| Mean selection ratio | 0.513 | 0.425 | 0.574 |

**The bar (Wilson upper bound at or below 5%) is met on the ledger path, with the marks.** Without them the ledger path misses 9 of 274 (block `p1` in 5, `of1` and `of2` in 3, `pl3` in 1), so the marks carry the result on this path as on the section path.

Same limits as PR 983: one suite, one agent model, marks learned on the 290 and tool-name links designed on the 90, 110 and 290 (the 274 served for neither). The ledger path costs 51% of the blocks against 57% for the section path, because a unit edit reaches fewer blocks than its whole section.

## Population

The same 274 as PR 983. 26 of the 300 drawn were left out, all by the duplicate rule of the PREREG (6 tries each, none by the validity gate): 21 `negate` and 5 `rephrase`. The sample holds 129 measured negations, not the planned 150, and 145 rephrasings. Worst case, had all 26 missed: 26 of 300, 8.7% observed, Wilson 95% upper bound 12.4%. The claim holds for the gate-valid, non-duplicate population as the PREREG defined it. Per operator, with 0 misses on this path as on the section path: `negate` 129 measured, upper 2.89%; `rephrase` 145 measured, upper 2.58%. Cost: `cost-fresh.json`.
