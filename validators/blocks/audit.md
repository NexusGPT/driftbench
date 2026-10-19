# Blocks validator: the independent audit (docs/validators.md section 12.7)

Each verdict line below is copied as the audit helper sent it; the builder writes none of them. Round 1 ran on the bank of trial6 (base 57a73134c, 3,308 items). The channels and bugs it found were closed in the bank at 06fed40a4 and after; round 2 re-runs the cheater and the planted bugs on the closed bank, and its lines replace round 1's.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pass | trial6: ten blind rows in journal.jsonl; score 0.7524, forecast 255.9, 65 distinct failing causes against the blocks bar (0.8, 100, 60) |
| cause review | pass | 29/30 = 0.97, 18 distinct changes against 18 (second draw, a fresh reviewer, after the foundation re-tag; the first draw failed at 11/30 before it) |
| cheater | fail | C1 seed-1 table +76 (seeds 2,3,hidden +21,+20,+20); C2 oracle read from disk +130 (trial +130,+131,+131,+130); C3 fixture tool names +31; C4 fixed verdict shapes +64; C5a keep unknown keys +11 (16 lost); C5b skip validation +11 (111 lost) |
| planted bugs | fail | 10 of 20 |

## Round 1 to round 2: what changed in the bank

- C2 and argv or env sniffing: the measure job loads the bank from memory, deletes its source, the validators package, the git history and the network before the product runs, and every check runs with a neutral argv, execArgv, cwd and env (`blocks/isolated/`, `runItem`).
- C1, C3, C4 on the value items: every name and value is drawn from the seed, the fixed catalogue is gone, and every case has a twin whose right answer differs (`levels/values.ts`).
- C4 on the evidence and report items: each item also judges a twin of another answer (`levels/evidence.ts`, `contracts2/reports.ts`).
- C5a and C5b: refusal twins the docs define, and a read-back of what was loaded (`levels/diagnostics.ts`, `contracts2/objects.ts`, `contracts2/reports.ts`).
- Planted bugs: 38 catch items for nine of the ten missed bugs (`blocks-growth/plantedbugs/`); bug 14 (the workspace check's changed set not path-normalised) breaks no documented rule, a doc ruling is open.
