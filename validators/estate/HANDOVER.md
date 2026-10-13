# Handover: validator estate

Continue on `exec/estate-v3`, draft PR 154. Iterations 29 to 32 were made by a fresh Opus takeover in a separate worktree (`.worktrees/exec-estate-fresh`, detached, pushed with `git push origin HEAD:exec/estate-v3`). The older worktree `.worktrees/exec-estate-v2` holds an unrelated local change to `research.md` and is not used. Never edit the validator or bank.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 0 |
<!-- level-table:end -->

Iteration 32, head 26b334d7: seed 1 passes 1016 of 1170 items. The reader level passes 640 of 641. The only reader item left is `scan.hostile.prompt-hook`, and no correct reader can pass it (see "Item defect" below). So the ladder stays at level 0 until the maintainer fixes that item.

| Level | Passing at the takeover (5fbc3c9a) | Passing now (26b334d7) |
|---|---|---|
| reader | 584/641 | 640/641 |
| lint | 45/46 | 45/46 |
| plan | 44/65 | 44/65 |
| generation | 196/270 | 196/270 |
| agent-mutants | 22/75 | 22/75 |
| maintenance | 49/53 | 49/53 |
| scale | 20/20 | 20/20 |

Item by item against the takeover run: 56 gained, none lost. Scale items are timing on a loaded host. They passed 20, 18, 19, 17 and 20 times across the five sweeps, with no change to scale code.

The cross-seed sweep (seeds 1 to 20 and hidden) was not rerun after these changes. It stops at the first failing level, which is level 1 on every seed while the defect stands.

## Floor

No estate floor is registered in `validators/floors.json`. The ladder is at level 0.

## Item defect (for the maintainer)

`scan.hostile.prompt-hook` (bank: `packages/validators/src/ladders/estate/bank/hostile.ts`, key `prompt-hook`) cannot pass:

* It writes `.claude/settings.json` with `e.raw(SETTINGS, ..., o)`. That is a raw file owned whole by the item with no planted atom, and `PlantedEstate.judge` reports every atom found in it as "never planted".
* Its check then requires `scan.map.atoms.some((atom) => atom.kind === 'guard')`. The only file that can hold that guard atom is the settings file.
* Without a guard atom (the reader at 5fbc3c9a): "the prompt hook gave no guard atom". With one (the reader now, which reads a prompt hook as a guard with no script): "found guard guard.settings.stop-guard-check-the-reply at .claude/settings.json:3, never planted".
* Reproduce, in a checkout of this branch with dependencies installed: `git checkout 5fbc3c9a -- packages/estate/src`, then run the family. Then `git checkout HEAD -- packages/estate/src` and run it again. Runner: a script that imports `BANK_LEVELS` and `familyResults` from `packages/validators/src/ladders/estate/bank/index` and runs the `scan.hostile` family on seed 1 (about 2 seconds).
* Suggested fix: plant the guard, for example `e.expect(o, { hid: \`${o}:guard\`, kind: 'guard', file: SETTINGS, line: 3, key: 'check-the-reply' })`, or write the file with a FileWriter and attach the atom to line 3.

## Open items

First failing level (reader), seed 1: `scan.hostile.prompt-hook` only (the defect above).

Beyond level 1, from the all-level run at 26b334d7 (98 failing items, 57 distinct causes):

| Family | Failing |
|---|---|
| unit.runner | 41 |
| kill.fake | 31 |
| mutant.agent | 22 |
| plan.relevance | 20 |
| gen.complete | 14 |
| gen.task | 9 |
| gen.coverage | 5 |
| gen.asks | 4 |
| maintain.impact | 3 |
| gen.reads | 1 |
| lint.defect | 1 |
| maintain.fixture | 1 |
| plan.contract | 1 |

## Hypotheses tried

### Iteration 29

960/1170 to 960/1170 (reader +2, scale -2 on timing). Registry and catalogue rules given as objects (`{ "id": "R3" }`, `{ "quote": "..." }`) were dropped. They are now read; the prepared `object-rules.test.ts` (11 cases) passes.

### Iteration 30

960 to 989. Eight one-cause commits, each with a red test first:

* step lists in more shapes;
* guard commands after `cd` or behind `sh -c`, and catalogue guards named by their command;
* lower-case registry labels;
* frontmatter with CRLF line ends or tabs;
* notes on hooks in a shape the reader cannot read, and prompt hooks;
* helpers in subfolders, and skills or helpers that share a name;
* hazards in other words, and none inside quoted examples;
* paths with backslashes, a line number, `$CLAUDE_PROJECT_DIR` or a wiki link.

### Iteration 31

989 to 1003. Six commits:

* gates in five more wordings, a markdown link as the file, and no gate in a quoted example or in "never read Y before X";
* no citation from a numbered thing ("tax form R1"), and no enforcement from a literal that quotes only a small part of a rule;
* a script anchored on the line that runs it;
* routing cells that link to the unit file or name a slash command;
* the ask column of a routing table found by its header;
* no reference in change notes.

### Iteration 32

1003 to 1016. Seven commits:

* the lint size counted in code points;
* dispatch of a helper named without backticks;
* `.txt` references, and documents named by prose read as prose;
* reference edges for chained references;
* routing written as prose;
* standing files in subfolders;
* `@` imports.

### What the previous executor got wrong

The earlier stuck record held back 14 reader items as "contract conflicts": gate wordings beyond the four, routing outside tables, extra standing files, and relaxed step JSON. `NEEDS.md` keeps them in the bank, and none contradicts a decoy item. They were passable product gaps, and `docs/estate.md` and `docs/adapters/claude-code.md` now name the forms. Measurement note: each journal row of iterations 30 to 32 covers several one-cause commits measured by one sweep, because a full sweep takes 8 to 20 minutes on this host. Each commit was checked by running its affected families.

## Next actions

1. Maintainer: fix `scan.hostile.prompt-hook` in the bank (see "Item defect"). Then the reader level passes on seed 1. Run `pnpm -s driftbench validate estate --seeds 1..20 --hidden --json` to confirm across seeds.
2. Then climb level 2: `lint.defect.dispatcher-target-missing`. A dispatcher (`.claude/hooks/lib/run.py gone-hook`) names a hook script that does not exist; the lint must report MISSING_SCRIPT. The cause is in `scriptOf`/`scriptIn` (claude-code.ts): a bare word after a dispatcher that names no file is dropped, so no missing script is recorded.
3. Level 3 is `plan.contract.journey-route` and the 20 `plan.relevance` items. Read the previous handover's warning first: `plan.relevance.helpers-running` was judged to conflict with the documented covering-array tuples. Check that claim against `docs/estate.md` section 4 before you accept it.

## Pitfalls

* No model calls. All regression estates are fictional. Use `vitest --maxWorkers=2` and one validator sweep at a time; the host is heavily loaded.
* Scale items are timing. Judge them by counts across runs, never by one run.
* `map-cache.test.ts` ("reads the copy when the text is the same") once failed under load, then passed alone.
* An `@path` is an import only in a standing or memory file. In a skill body it stays a file to read (`unquoted-paths.test.ts`).
* A guard literal enforces a rule only when it states most of it (60 percent) or equals a span the rule itself quotes (`git push --force`). The unit runner test of a leaky guard depends on the second case.
* `unit.runner` passes YAML core specs to the native JSON unit runner (previous executor's diagnosis, not rechecked here).
* Never `git stash`: the stash is shared across worktrees.

## How to run

```sh
pnpm -s driftbench validate estate --seed 1 --items --all-levels --json
pnpm -s driftbench validate estate --seeds 1..20 --hidden --json
pnpm -s driftbench validate estate --brief --fresh
pnpm -s driftbench validate estate --check-handover
pnpm exec vitest run packages/estate --maxWorkers=2
```

The first command measures every bank item on seed 1; it takes 8 to 20 minutes here. To work faster, run single families with a script that imports `BANK_LEVELS` and `familyResults` from the bank index. Each family takes seconds, except `estate.determinism`, which takes about 5 minutes. Measure in a second worktree checked out at the commit, so a sweep never reads half-edited source.

## Fixtures

* `packages/validators/fixtures/estate/seed-1.yaml` and `holdout-1.yaml` hold generated fictional estates.
* Bank generators under `packages/validators/src/ladders/estate/bank/` plant inputs in temporary folders. Read them to diagnose; never edit them.
* `examples/estates/fixture`, `fixture-v2` and `reader-cases` hold committed fictional estates and their recorded answers. `scan/cases.test.ts` checks that `reader-cases/map.yaml` matches a fresh scan.
* Regression tests for this takeover are under `packages/estate/test/scan/`, plus `test/lint-characters.test.ts`. Their fake ports make no model calls.
