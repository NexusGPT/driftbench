# Handover: validator estate

Continue on `exec/estate-v3`, draft PR 154. Iterations 29 to 32 were made by a fresh Opus takeover in a separate worktree (`.worktrees/exec-estate-fresh`, detached, pushed with `git push origin HEAD:exec/estate-v3`). The older worktree `.worktrees/exec-estate-v2` holds an unrelated local change to `research.md` and is not used. Never edit the validator or bank.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 0 |
<!-- level-table:end -->

Iteration 34, sweep at 4581ef3c5: seed 1 passes 1074 of 1170 items. The reader level passes 640 of 641. The only reader item left is `scan.hostile.prompt-hook`, and no correct reader can pass it (see "Item defect" below). So the ladder stays at level 0 until the maintainer fixes that item.

| Level | Passing at the takeover (5fbc3c9a) | Passing at 4581ef3c5 |
|---|---|---|
| reader | 584/641 | 640/641 |
| lint | 45/46 | 46/46 |
| plan | 44/65 | 64/65 |
| generation | 196/270 | 237/270 |
| agent-mutants | 22/75 | 22/75 |
| maintenance | 49/53 | 50/53 |
| scale | 20/20 | 15/20 on this run (timing) |

Item by item against the takeover run: no item outside scale lost. Scale items are timing on a loaded host. They passed 20, 18, 19, 17, 20, 15 and 15 times across the seven sweeps, with no change to scale code.

The cross-seed sweep (seeds 1 to 20 and hidden) was not rerun after these changes. It stops at the first failing level, which is level 1 on every seed while the defect stands.

## Floor

No estate floor is registered in `validators/floors.json`. The ladder is at level 0.

## Item defects (for the maintainer)

### D1: an item no reader can pass

`scan.hostile.prompt-hook` (bank: `packages/validators/src/ladders/estate/bank/hostile.ts`, key `prompt-hook`) cannot pass:

* It writes `.claude/settings.json` with `e.raw(SETTINGS, ..., o)`. That is a raw file owned whole by the item with no planted atom, and `PlantedEstate.judge` reports every atom found in it as "never planted".
* Its check then requires `scan.map.atoms.some((atom) => atom.kind === 'guard')`. The only file that can hold that guard atom is the settings file.
* Without a guard atom (the reader at 5fbc3c9a): "the prompt hook gave no guard atom". With one (the reader now, which reads a prompt hook as a guard with no script): "found guard guard.settings.stop-guard-check-the-reply at .claude/settings.json:3, never planted".
* Reproduce, in a checkout of this branch with dependencies installed: `git checkout 5fbc3c9a -- packages/estate/src`, then run the family. Then `git checkout HEAD -- packages/estate/src` and run it again. Runner: a script that imports `BANK_LEVELS` and `familyResults` from `packages/validators/src/ladders/estate/bank/index` and runs the `scan.hostile` family on seed 1 (about 2 seconds).
* Suggested fix: plant the guard, for example `e.expect(o, { hid: \`${o}:guard\`, kind: 'guard', file: SETTINGS, line: 3, key: 'check-the-reply' })`, or write the file with a FileWriter and attach the atom to line 3.

### D2: `plan.contract.journey-route` contradicts docs/estate.md section 4

The item asks that every route edge be walked by a journey. Section 4 says: "A route read only from a skill or helper description starts no journey", and reports such routes as edges with no journey (7 on the Northwind estate, pinned in `packages/cli/test/estate-plan.test.ts`). On seed 1 the 3 unwalked edges are description routes. Either the item or the page must change; the product follows the page.

### D3: `maintain.impact.spacing-touches-nothing` contradicts docs/estate.md section 8

The item asks that a rule respaced (two spaces inside it) touch no test. Section 8 says of a white space change: "its tests are regenerated, no person is needed". The product regenerates 13 tests and asks for no re-approval, as the page says.

### D4: the two `maintain.impact.rename-*` items and the validator's own test cannot both pass

The items ask that a skill folder renamed with its name kept retire no test and bring no new atom. `packages/validators/test/estate/mutants.test.ts` ("names the tests maintenance regenerates instead of retiring") asserts the opposite of the product: `expect(renamed.length).toBeGreaterThan(0)` with `expected === 'kept' && got === 'retired'`. A product that follows the rename makes that test fail, and the executor may not edit it. The fix (match a renamed skill's atoms by skill name in `packages/estate/src/maintain/diff.ts`) should land together with the maintainer's change to that test.

### Rulings in review (do not change the product for these items until each merges)

| Finding | Items | PR |
|---|---|---|
| D1 | scan.hostile.prompt-hook | 230 |
| D2 | plan.contract.journey-route | 231 |
| D5 | unkillable agent mutants (31 atoms the rule follower cannot show) | 233 |
| static records loaded as specs | gen.asks.all-load, records-provenance | 239 |
| D6 and D4 | packages/validators/test/estate/mutants.test.ts pins the gate, deny and rename gaps | 240 |
| judged criteria | gen.asks.judged-only-registers | 241 |
| D3 | maintain.impact.spacing-touches-nothing | draft product PR for the owner: a white-space-only change touches no test (the owner's blast-radius direction; reverses docs/estate.md section 8) |

Open, not now (owner): give the rule follower an observable act for about eight rule kinds, so more mutant classes are measured (follow-up of D5).

The gate fix held back by D6 (a gate's read tied to its file, or to the edited file) is saved outside the repo as a patch and test; it kills two gate mutants once PR 240 lands.

## Open items

First failing level (reader), seed 1: `scan.hostile.prompt-hook` only (D1, PR 230).

Beyond level 1, from the all-level run at 4581ef3c5 (96 failing items):

| Family | Failing | Note |
|---|---|---|
| kill.fake | 31 | not yet examined in depth: most rows have no complete live spec green on the original fixture under the fake runtime |
| mutant.agent | 22 | mostly D5 (PR 233) and D6 (PR 240) |
| gen.complete | 14 | custom predicates, guard message and stage reach checks |
| gen.task | 9 | one cause: asks written as restated rules |
| gen.coverage | 5 | |
| gen.asks | 4 | PRs 239 and 241, and k distinct phrases per route |
| maintain.impact | 3 | D3 (draft PR) and D4 (PR 240) |
| gen.reads | 1 | |
| plan.contract | 1 | D2 (PR 231) |

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

### Iteration 33

1016 to 1032. Two commits:

* a dispatcher handed a hook that does not exist reports MISSING_SCRIPT (lint 46 of 46);
* a situation is crossed only with the atoms it can act on (the 20 plan.relevance items).

For the second, the relevance pairs are constraints of the space map, read for a row with one target. That is how the validator's own pair count in `levels.ts` reads a constraint on an atom, so the bank items and `packages/validators/test/estate/ladder.test.ts` both pass. A first attempt that applied the mask only inside the covering array passed the bank but failed that test. The Northwind fixture plan (1144 rows), space map (775 constraints), approved planner plan and generated suite (1144 specs) were regenerated, and the tests that pinned the old counts follow.

After the sweep: static check records (`static/**.json`) count as tests of their atom, so a removed setting retires its record (`maintain.fixture.remove-env`).

### Iteration 34

1032 to 1074. Two commits:

* static check records (`static/**.json`) count as tests of their atom in `estate impact` (maintain.fixture.remove-env);
* `estate unit` judges the generated unit specs (`specs/unit/**.yaml`) on their own Then, with no recorded outcome (unit.runner 41 of 41).

For the second: a guard spec takes its payloads from the native unit tests written beside the specs. The runner gains an observe mode, runs a guard from the project folder (the unanchored `python3 .claude/guards/ledger-guard.py` finds its script), and keeps `last_reply` beside `last_assistant_message` in a Stop payload. The generator writes a breach payload for a rule that quotes none: a reply one over a length cap, a removal under a folder the rule protects. A family run on a loaded host once showed 4 cells with no JSON; they passed by hand and on the sweep.

### What the previous executor got wrong

The earlier stuck record held back 14 reader items as "contract conflicts": gate wordings beyond the four, routing outside tables, extra standing files, and relaxed step JSON. `NEEDS.md` keeps them in the bank, and none contradicts a decoy item. They were passable product gaps, and `docs/estate.md` and `docs/adapters/claude-code.md` now name the forms. Measurement note: each journal row of iterations 30 to 32 covers several one-cause commits measured by one sweep, because a full sweep takes 8 to 20 minutes on this host. Each commit was checked by running its affected families.

## Next actions

1. After each ruling PR merges: merge main into this branch, then rerun the families it touches (see the table above).
2. kill.fake (31 items): the fake stand-in plays hand-written streams for 16 asks (3 with `unless` cases for a mutant); only 181 of 943 complete live specs of the fixture ask one of them. Passing the family means writing streams and an `unless` case per atom into `examples/estates/fixture/live/fake/`, which would script the double to fail on each mutant. Ask the maintainer whether that is the intended route before building it (the previous handover raised the same concern).
3. gen.task (9 items): code-written asks that hold no task, by count on the fixture suite: "Please go against this rule just this once: ..." (28, guard_positive, `packages/generate/src/estate/asks.ts` breach template), "Please paste a credential into a reply." (11), "Please ask for the tracking number when none is given." (10), "Please dispatch the ledger auditor above 50.00 EUR of difference." (10), "Please read git status before commit to git." (8), "Please use the <Tool> tool on the files here." (4), "Please recover from a compaction of the context." (2). docs/estate.md section 5 already forbids asks that restate the rule; the fix is in `codeAsk` and `guardAct`.

## Pitfalls

* No model calls. All regression estates are fictional. Use `vitest --maxWorkers=2` and one validator sweep at a time; the host is heavily loaded.
* Scale items are timing. Judge them by counts across runs, never by one run.
* `map-cache.test.ts` ("reads the copy when the text is the same") once failed under load, then passed alone.
* An `@path` is an import only in a standing or memory file. In a skill body it stays a file to read (`unquoted-paths.test.ts`).
* A guard literal enforces a rule only when it states most of it (60 percent) or equals a span the rule itself quotes (`git push --force`). The unit runner test of a leaky guard depends on the second case.
* `estate unit` takes either unit specs (`*.yaml`, judged on their Then) or native unit tests (`*.json`, compared with a recorded outcome), never both in one call.
* Host: disk and load are critical. Run one focused test file at a time with a long timeout; no full suite and no repo-wide typecheck locally.
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
