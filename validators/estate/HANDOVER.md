# Handover: validator estate

Continue on `exec/estate-v3`, draft PR 154. Iterations 29 to 38 were made by a fresh Opus takeover in a separate worktree (`.worktrees/exec-estate-fresh`, detached, pushed with `git push origin HEAD:exec/estate-v3`). The older worktree `.worktrees/exec-estate-v2` holds an unrelated local change to `research.md` and is not used. Never edit the validator or bank.

## Current takeover baseline

Iteration 40 at 59f4b083b merges main, including PR 274 and D11/D12. Seed 1, run alone: level 3, 1108/1169. Reader 641/641, lint 46/46, plan 65/65, generation 244/270, agent-mutants 46/74, maintenance 51/53, scale 15/20. The earlier sections below retain the prior executor history.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 3 |
<!-- level-table:end -->

Iteration 39, sweep at 32c570683 (main merged in, run alone): seed 1 passes 1103 of 1170 items and the ladder is at level 3. Reader, lint and plan pass in full. Generation is the first failing level (244 of 270). The handover was made here on the owner's instruction: building moves to other helpers.

| Level | Passing at the takeover (5fbc3c9a) | Passing at 32c570683 |
|---|---|---|
| reader | 584/641 | 641/641 |
| lint | 45/46 | 46/46 |
| plan | 44/65 | 65/65 |
| generation | 196/270 | 244/270 |
| agent-mutants | 22/75 | 41/75 |
| maintenance | 49/53 | 51/53 |
| scale | 20/20 | 15/20 on this run (timing) |

Item by item against the takeover run: no item outside scale lost. Scale items are timing on a loaded host. They passed 20, 18, 19, 17, 20, 15, 15, 15, 15, 15, 15 and 15 times across the twelve sweeps, with no change to scale code.

The cross-seed sweep (seeds 1 to 20 and hidden) was not rerun. Run it now that level 1 passes on seed 1.

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

### Rulings (all merged on main on 2026-10-13)

| Finding | Items | PR |
|---|---|---|
| D1 | scan.hostile.prompt-hook | 230 |
| D2 | plan.contract.journey-route | 231 |
| D5 | unkillable agent mutants (31 atoms the rule follower cannot show) | 233 |
| static records loaded as specs | gen.asks.all-load, records-provenance | 239 |
| D6 and D4 | packages/validators/test/estate/mutants.test.ts pins the gate, deny and rename gaps | 240 |
| judged criteria | gen.asks.judged-only-registers | 241 |
| D3 | maintain.impact.spacing-touches-nothing | draft product PR for the owner: a white-space-only change touches no test (the owner's blast-radius direction; reverses docs/estate.md section 8) |

PRs 230, 231, 233, 239, 240, 241 and 244 are in this branch through the merge at 32c570683. PR 274 (kill.fake judges settings by their static tests and names the documented equivalent mutants) merged on main after that merge and is NOT in the branch yet. After each later ruling merges: merge main (`git fetch origin main && git merge origin/main`), run the estate and validator estate test files one at a time, then one full sweep run alone, then a journal row.

Open, not now (owner): give the rule follower an observable act for about eight rule kinds, so more mutant classes are measured (follow-up of D5).

The gate fix held back by D6 (a gate's read tied to its file, or to the edited file) is saved outside the repo as a patch and test; it kills two gate mutants once PR 240 lands.

## Open items

First failing level: generation (level 4 of the ladder table), seed 1, 26 items.

All failing items at 32c570683 (67):

| Family | Failing | Note |
|---|---|---|
| kill.fake | 27 | classified one by one under "Next actions", item 2; PR 274 changes the settings and equivalent-mutant items, remeasure after merging main |
| gen.complete | 14 | custom predicates, guard message and stage reach checks |
| mutant.agent | 7 | not examined since the merge; the gate fix saved as a patch may apply now that PR 240 is in |
| gen.task | 6 | see "Next actions", item 3 |
| gen.coverage | 5 | |
| scale | 5 | timing on a loaded host |
| maintain.impact | 2 | the two rename items (D4): PR 240 is in, so the rename fix in `packages/estate/src/maintain/diff.ts` can now be made |
| gen.asks | 1 | not examined since the merge |

Product gaps the coordinator named, and their state:

* Live specs for script atoms: built (journeys walk script edges). Their specs are red on the original because the fixture's recorded streams skip the script.
* Live specs for reference atoms: the file-list fallback is built; the conditional currency read waits for an approved non-EUR situation; the matching-rules read is green through a recorded stream on original and mutant.
* Live specs for gate atoms: not built. gate-1's end is prose (`needs-ordered-anchor`, documented and pinned by a test). Needs a ruling.
* Tool asks loading their skill: built for declared tools (`owners()` in `plan/contract.ts`).
* States and a judge for the 8 not green on the original: not buildable in the product; the bank's run passes neither (reproduced under "Next actions", item 2).
* The misroute comment in `plan/contract.ts` (was line 199): fixed in 869c1e025, with the plan files.

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

### Iteration 35

1074 to 1076. One commit: an act taken from the title of an instruction, a gate or an output rule restates the rule (docs/estate.md section 5), so code writes no ask from it and the row waits for an approved phrase. gen.task 14 to 16 of 23, nothing lost. Refusing guard and hazard asks too was tried and dropped: it cost 4 items elsewhere (gen.complete guard_positive, gen.reads, gen.coverage hazard). The Northwind suite now has 847 complete specs (was 980).

### Iteration 36

1076 to 1080. One commit: the fixture's fake runtime acts from the estate copy for an ask it holds no stream for (`examples/estates/fixture/live/fake/agent.mjs`), and a recorded guard or step row plays only while the copy declares it. Nothing in the fake names a test or a mutant; no stream is written per atom (owner ruling). kill.fake 0 to 4 of 31.

### Iteration 37

1080 to 1082. Two commits. (1) `estate generate` checks reads against the files the map knows when the folder beside the map holds no estate (674c07f84). (2) A declared tool's row names the skill that declares it, so its ask loads the skill; the fake runs the command a loaded skill's body says to run; the misroute row note now says what docs section 5 says (the ask names no skill) (869c1e025). Generation 239 to 241. kill.fake unchanged at 4: tool-1 turned green on the original and honestly lives.

### Iteration 38

Two commits. (1) Journeys walk a skill to the script its body runs, so scripts get live specs; a focus atom counts its complete specs once per ask and cell (7bbdf67cb). (2) A journey through a reference read under a condition waits for a situation that sets the condition off (48a078786). Plan 1145 rows, suite 847 complete. Family runs: plan 64, generation 241, kill.fake 4, all unchanged; the full sweep is row 38 of the journal.

### Iteration 39

1082 to 1103, level 0 to 3, with no product change: main merged in after the rulings merged. Reader 641, plan 65, generation 244, agent mutants 41, maintenance 51.

### What the previous executor got wrong

The earlier stuck record held back 14 reader items as "contract conflicts": gate wordings beyond the four, routing outside tables, extra standing files, and relaxed step JSON. `NEEDS.md` keeps them in the bank, and none contradicts a decoy item. They were passable product gaps, and `docs/estate.md` and `docs/adapters/claude-code.md` now name the forms. Measurement note: each journal row of iterations 30 to 32 covers several one-cause commits measured by one sweep, because a full sweep takes 8 to 20 minutes on this host. Each commit was checked by running its affected families.

## Next actions

1. The next three steps, in order:
   * Merge main again to take PR 274, run the estate test files one at a time, then one full sweep alone, and write journal row 40. Remeasure kill.fake: the setting, invariant and skill items should change.
   * maintain.impact rename items (2): make the rename fix in `packages/estate/src/maintain/diff.ts` (match a renamed skill's atoms by skill name), red test first; then try the saved gate patch (`gate-pairs.patch` and `gate-pairs.test.ts`, kept outside the repo in the session scratchpad under `opus/estate/`) against mutant.agent.
   * Generation, the first failing level: gen.complete (14), starting with the items whose marker is a registered check the runner lacks (guard message, guard timing, stage reach); one cause per commit, red test first.
2. kill.fake: 4 of 31 with the estate-derived fake (route-1, guard-2, stage-1, stage-2). Iterations 37 and 38 built the product gaps the coordinator named; the 27 left, by why:
   * Built, now honest lives or honest waits (no ruling needed, written here so no one re-opens them):
     * tool-1: the tool_boundary row of a declared tool now names its skill (`plan/contract.ts` `owners()`), so the ask loads the skill, and the fake runs the command the skill body says to run. The spec is green on the original. On the delete mutant it stays green: the settings allow `Bash(python3 *)`, so an agent may still run the script without the skill's declaration. An honest live.
     * tool-2 (declared `Edit` of invoice-reconcile): the spec now loads the skill, but the skill's body never edits anything (step 4 says never change an amount), so no run of a task of that skill calls `Edit`. The `permission` check (`declared`: at least one covered call) cannot pass. A declared tool the body never uses has no act to observe; the item is unreachable for it.
     * script-1 and -2: journeys now walk a skill to the script its body runs (`plan/journeys.ts`, edge kind `script`), so each script has a complete live spec (journey.09 runs reconcile.py, journey.04 runs track.sh). Both asks are approved phrases that the fixture's manifest maps to recorded streams (`streams/invoice-match.jsonl`, `streams/late-shipment.jsonl`), and both recordings skip the script (the agent read the files and answered). The spec is right to fail them. Rewriting a recording per atom is ruled out. With the derived agent instead of the recording (tried on a scratch copy of the fake), journey.09 passes; journey.04 fails: the derived agent does not route "Where is shipment NW-55012?" to the tracker skill (no skill load, no script call). Question for the maintainer: drop the recorded streams the derived agent can replace, or keep them and accept these two.
     * reference-1 (currency table, read "When the invoice is not in EUR"): its only live spec, journey.08, asked about a EUR invoice, so it failed the agent for obeying the condition. It now waits under needs-approved-phrase, as its read_when row does, until a non-EUR invoice situation is approved in `phrases.yaml`. Writing that situation is writing the bank, the person's step in the real flow; left alone.
     * reference-2 (matching rules): green on the original through the recorded `invoice-match` stream, which keeps reading the file on the mutant. Same question as scripts.
   * For a ruling (sent to the maintainer by the coordinator):
     * gate-1 and its invert: "Read references/matching-rules.md before matching any line" has an end that is prose, no act; `needs-ordered-anchor` is the documented gap (docs/estate.md section 6) and `packages/generate/test/estate/then.test.ts` "still names a gap for an end that is no act" pins it.
     * setting-1 and -2, invariant-1 and -2: static by design; their tests are static records, never live specs.
     * skill-1 and -2: `estate mutate` refuses the delete as an equivalent mutant.
     * gate-2, route-2, subagent-1 and -2, register-1 and its invert: green on the original and honestly green on the mutant (see iteration 36).
   * Not green on the original, cannot be fixed without the validator (8): instruction-1, -2 and its invert carry a judged criterion, and `runOnFake` (`packages/validators/src/ladders/estate/bank/fixture-suite.ts`) passes no `--judge`. The fixture's fake judge (`live/fake/judge.cjs`) fails only on the words of `FAKE_JUDGE_FAIL`, blind to the rule, so even wired it would pass both the original and the mutant: no kill. guard-1 and register-2 carry session-state cells and hazard-1 and -2 plant their hazard only through `--states`; `runOnFake` passes no `--states`. A states library placed beside the estate as a default would make every mutant copy fail to load it, counted as a kill: false kills. Reproduced at 48a078786 with S = `examples/estates/fixture/generated/specs/live/obligation/estate.obligation.instruction.inbox-triager.a-message-that-fits-no-folder.yaml`: `pnpm -s driftbench estate run S --estate examples/estates/fixture --runtime claude-code --command examples/estates/fixture/live/fake/claude.mjs --store <tmp>/a.db` fails with the judged criterion "inconclusive" (no judge). Adding `--judge claude:fake --judge-command examples/estates/fixture/live/fake/judge.cjs` passes it, and passes it again on the copy written by `pnpm -s driftbench estate mutate examples/estates/fixture/approved.yaml --atom instruction.inbox-triager.a-message-that-fits-no-folder --delete --to <tmp>/mut`.
3. gen.task (6 items left; none has a docs rule that code can follow without matching the oracle's own verb list): the guard_positive breach template ("Please go against this rule just this once: ...", `guardAct`), "Please help me with ..." from `askedTo` (help is no task verb of the oracle), tool rows ("Please use the Read tool on the files here", left alone: docs section 5 does not name tool asks), the stop word as a twin ("stop"), and no complete hazard_recovery spec (read_when now passes).

4. `packages/cli/src/commands/estate-stats.ts` counts edge coverage over route, reference, dispatch and next edges (and docs/estate.md shows that code). Journeys now also walk script edges; the stats edge list was left as it is to keep iteration 38 small. Decide whether coverage should count script edges too, and change both together.

## Pitfalls

* No model calls. All regression estates are fictional. Use `vitest --maxWorkers=2` and one validator sweep at a time; the host is heavily loaded.
* Scale items are timing. Judge them by counts across runs, never by one run.
* `map-cache.test.ts` ("reads the copy when the text is the same") once failed under load, then passed alone.
* An `@path` is an import only in a standing or memory file. In a skill body it stays a file to read (`unquoted-paths.test.ts`).
* A guard literal enforces a rule only when it states most of it (60 percent) or equals a span the rule itself quotes (`git push --force`). The unit runner test of a leaky guard depends on the second case.
* `estate unit` takes either unit specs (`*.yaml`, judged on their Then) or native unit tests (`*.json`, compared with a recorded outcome), never both in one call.
* Host: disk and load are critical. Run one focused test file at a time with a long timeout; no full suite and no repo-wide typecheck locally.
* Never `git stash`: the stash is shared across worktrees.
* Run nothing beside a sweep. A sweep at 48a078786 with two `estate run` commands beside it read 920: every fixture family threw "plan approve exited 143" (a timeout). Rerun alone, it read 1082.
* The measuring worktree `.worktrees/exec-estate-measure` no longer exists; sweeps 60 to 62 ran in this worktree with no source edit during the run.

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
