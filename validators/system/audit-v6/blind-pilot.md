# Blind pilot, tree-b (branch audit/system-v6-b)

Method: worked from the failing-item list only, plus product code and docs. No reads under the ladders/system, fixtures/system or validators/system folders, no handover or journal files. One fix per iteration, test red first, then green, one commit. Raw measures: audit/blind-b/m0.json to m5.json.

| Iter | Commit | Hypothesis | Files | Score | Fixed |
|---|---|---|---|---|---|
| 0 | e5109bae3 (unchanged) | baseline | none | 281/319 | n/a |
| 1 | 0d54e6754 | `localizeRuns` charges the run position (`block.index`), so a driver-injected block in mode P shifts every later verdict one block; it must map through `specBlocks` to the authored index | packages/core/src/radius/localize.ts; test radius/localize-perturbed.test.ts | 301/319 | 20 |
| 2 | 48ca7b5f6 | `localizeRows` gives every block all earlier blocks as ancestors, ignoring `block.parent`, so a second forest root or a child authored before its parent is charged wrong; ancestors must be the parent chain when the spec has parent links | packages/core/src/radius/localize.ts; test radius/localize-forest.test.ts | 307/319 | 6 |
| 3 | fa569412d | `sectionSelection` forward closure is "every block after the first selected one", ignoring `block.parent`; in a parent forest it must select descendants whatever the authored order | packages/core/src/radius/select.ts; test radius/select-parent-blocks.test.ts | 313/319 | 6 |
| 4 | 9058e1430 | `radius localize` reads `--mode` through `optsWithGlobals`, so the parent `radius --mode` default F leaks in and a stored T campaign is read as F (zero suite runs, exit 1); without a typed `--mode` the campaign's own mode must be used | packages/cli/src/commands/radius-localize.ts; test cli/radius-localize-mode.test.ts | 315/319 | 2 |
| 5 | b236d29bf | `help <command> <subcommand>` prints the usage of the first word only (commander's help takes one name); it must print the usage of the subcommand | packages/cli/src/main.ts; test cli/help-subcommand.test.ts | 319/319 | 4 |

Items fixed per iteration over 1..5: 20, 6, 6, 2, 4 = 38 in 5 iterations, mean 7.6.

Notes:
- Each iteration's hidden seed differs (it is derived from HEAD); all 319 items passed on seeds 1..20 plus the hidden seed at iteration 5.
- Iteration 4 needed a reproduction by hand (a stored T campaign on the linked Acme specs) because the failure detail is cut to a few hundred characters; the printed `"mode": "F"` was the clue.
- Each hypothesis was formed from the first failing item's id, component and detail line, and its fix cleared the whole cluster that shared the cause (iteration 1: 20 items, of which 10 shift/perturbed plus forest and chain-localize perturbed items).
- A disk-free guard refused the first vitest run of iteration 3 (below 2 GB free); it cleared by itself, nothing was deleted.
- Not run: the full repository test suite and the typecheck; only the touched test folders (core radius, cli radius, cli help) and biome on touched files.

blind pilot: done 5 iterations, 7.6 items fixed per iteration, final 319/319
