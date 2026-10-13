# Handover: validator estate

Continue on `exec/estate-v3`, draft PR 154. Iterations 29 to 38 were made by a fresh Opus takeover in a separate worktree (`.worktrees/exec-estate-fresh`, detached, pushed with `git push origin HEAD:exec/estate-v3`). The older worktree `.worktrees/exec-estate-v2` holds an unrelated local change to `research.md` and is not used. Never edit the validator or bank.

## Current takeover baseline

Iteration 40 at 59f4b083b merges main, including PR 274 and D11/D12. Seed 1, run alone: level 3, 1108/1169. Reader 641/641, lint 46/46, plan 65/65, generation 244/270, agent-mutants 46/74, maintenance 51/53, scale 15/20. The earlier sections below retain the prior executor history.

## Current v4 result

Iteration 41 at aa9877712: seed 1 remains level 3. The isolated ladder stops at generation and does not measure scale: reader 641/641, lint 46/46, plan 65/65, generation 247/270. Iteration 42, on the unchanged product tree, measures agent-mutants 47/74 and maintenance 53/53. The non-scale total is 1099/1149 across these sequential runs. Scale remains 15/20 on the older loaded-host baseline and must only be remeasured on a quiet host.

The maintainer rules the negative reply-length item valid. aa9877712 fixes it: unqualified negative guard controls forbid deny, ask, warn and nudge, while ordinary allow invocations pass. Explicit verdicts remain exact. Regression red first, then 2/2; then 34/34; generate 32/32; CLI unit specs 5/5; gen.complete 84/97, up from 83/97. The earlier negative-guard ruling request below is resolved by this fix.

Next: apply further maintainer rulings to product code; merge each ruling PR when announced; remeasure seed 1 without scale until the host is quiet. Do not mark PR 154 ready until a level rises.

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

## v4 rulings: generation measured at 59f4b083b

The production checks already include guard_message, guard_finished and stage_seen. Adding those names does not fix these items. The isolated seed 1 report lists the failures below. A read-only reproduction used estateRun(1), specVerdicts(run), the generated spec and the follower trace. No validator file was changed.

| Item suffix under gen.complete | Evidence | Ruling needed |
|---|---|---|
| guard_negative-guard-reply-length-py | The guard has no registry verdict; its generated negative check counts any verdict as zero. follower.ts emits a Stop guard allow decision on every reply, including the outside ask. | Resolved as valid by the maintainer: aa9877712 counts intervention verdicts and permits ordinary allow invocations. |
| guard_register-guard-read-before-edit-py | follower.ts guardRow emits only at/event/check/verdict/session. It provides no stdout, stderr or reason. guard_message correctly reports no runtime output. | Supply the guard output the message check needs. |
| guard_register-guard-reply-length-py | The planted guard verdict is allow; guard_message correctly says it did not block. Its trace also lacks message output. | Supply a blocking case and its message, or define an allow-message contract. |
| hazard_recovery-hazard-after-compaction | replayOnFollower passes only asks to follow, ignoring the spec event. The returned transcript contains no compaction record. | Plant the event, so recovery can be observed. |
| journey-route-table; read_when-reference-skill | The planted menu-review supplier-recipes reference has exists:false; the file is absent by design. The generator reports needs-existing-file. | Exclude a deliberately missing target from complete-read requirements, or supply it. |
| read_when-reference-standing | The bank claims the menu task covers .claude/steps.json; the follower never reads that file. | Make the declared situation exercise the reference. |
| skip_pressure-gate-fixed-gate | Both skill pressure situations claim the fixed repair-ticket gate. The documented first matching situation is menu-review-pressure. Its follower reads menu files only. | Correct the situation membership for the scoped gate. |
| stage_anytime-stage-anytime; stage_order-stage-anytime | Every skill situation names stage:note. follower.ts walkOf explicitly filters out anytime stages, so note never appears. | Give the anytime stage a reachable situation and trace event. |
| tool_boundary-tool-allow | Every skill situation claims every permission. The selected menu task calls neither Grep nor Bash(git status). | Supply tasks that exercise each allowed call. |
| tool_boundary-tool-declared | The bank claims declared Glob on the menu task, whose follower never calls Glob. | Supply the helper/tool act the bank claims. |
| tool_boundary-tool-ask | The trace has no permission-prompt record. Production intentionally reports needs-registered-check for ask permission; docs/estate.md section 5 explicitly keeps ask as a gap. | Define an observable permission prompt and check contract. |
| tool_denied-tool-deny | The generated WebFetch exclusion is correct; the follower adapter reports no offered tools. Absence of a call cannot prove absence from offered tools. | Supply offered-tool metadata to the replay adapter. |

Sources: packages/validators/src/ladders/estate/{pipeline.ts,follower.ts,situations.ts}; packages/generate/src/estate/{then.ts,build-row.ts}; packages/checks/src/checks/estate.ts. The fixture input problems cannot be fixed by deleting expectations or accepting nonexistent observations in product code.

### v4 product fixes after the baseline

- f263fd3ef: match skill folder moves through a unique declared name. Rename regression red first, then 4/4; existing diff 10/10; maintain.impact 33/33. The validator planted-rename regression also passes.
- Gate ordering now binds a named Read to its file and an unqualified read-before-edit gate to the edited file. Saved regression red first, then 3/3; then 34/34; generate 32/32. mutant.agent 38/44, up from 37/44. An isolated seed 1 ladder and separate levels 5/6 confirm the gains; scale waits for a quiet host.

### v4 remaining generation quality rulings

Measured by focused runs at 778b3a04d. Guard task wording was a product gap: the positive and hostile asks now request concrete violations, derived from rule content. gen.task is 19/23; gen.asks is 23/24; gen.coverage is 20/25.

| Item | Evidence | Ruling needed |
|---|---|---|
| gen.asks.asks-approved | loop.ts compares every first ask with the approved phrase set, including 23 specs tagged ask:code. Five are neutral outside controls; eighteen are forced guard tasks. Section 5 explicitly allows tagged code fallback by default. | Respect fallback provenance, or run this item with --no-fallback. |
| gen.task.obligation | Four asks use the documented asked-about conversion: Please help me with a delivery, a tracking number or a late shipment. TASK_VERBS excludes help. | Judge the task semantically or include the documented construction. |
| gen.task.twin | The selected approved phrase is the literal stop. Section 5 expressly permits the user's stop trigger for a prompt guard, and approved phrases win. | Accept the prompt-guard exception; do not rewrite an approved phrase in product code. |
| gen.task.tool_boundary | The two asks say use the Glob/Read tool on the files here. The tool and target are present; TASK_VERBS excludes use. | Decide whether a tool-use task is valid; the verb list alone is no task-semantics test. |
| gen.task.hazard_recovery | Both asks request recovery from the declared compaction/new-session event. TASK_VERBS excludes recover. | Define whether the documented recovery test needs a separate work task and, if so, provide its situation. |
| gen.coverage.one-per-gate | Two gates lack complete specs: git status before commit has no approved work task; matching any line has no observable ending act. Rule-title fallback is forbidden by section 5. | Supply a task and an observable ending act. |
| gen.coverage.one-per-reference | Six references have no suitable task/situation, including the currency table conditional on non-EUR invoices and the deliberately missing KPI definitions document. | Supply legitimate conditions and existing files; do not turn a EUR task into a non-EUR read. |
| gen.coverage.one-per-tool | The only uncovered tool is ask Bash(git commit). Section 5 keeps ask permission as a gap. | Define the permission-prompt trace/check contract, also needed by gen.complete. |
| gen.coverage.needs-ordered-anchor | Nine specs need an anchor for matching any line. then.test.ts explicitly preserves this gap for prose with no observable act. | Name the observable act, or accept the documented gap. |
| gen.coverage.needs-recorded-session | Six guard replay rows have no recorded session in the supplied index. | Supply real recordings of those situations, or accept the explicit missing-session result. |

### v4 remaining agent mutant rulings

Focused mutant.agent is 38/44 after the gate fix. Each row below is one failing bank item, even where the item groups several atoms.

| Item suffix under mutant.agent | Evidence | Ruling needed |
|---|---|---|
| gate | The menu gate now dies. The repair-ticket skill gate lives because the standing gate independently reads the same closing-rules file before Edit. | Classify the deletion's equivalence in this follower, or plant independent prerequisites. |
| gate-fixed-gate | Removing the standing repair-ticket gate leaves the skill gate's identical prerequisite read intact. | Same duplicate-prerequisite issue. |
| instruction-no-force-push | All 15 selected tests use generic menu tasks. situations.ts includes the standing instruction on those tasks; first matching picks them ahead of push-branch. None requests a push. | Give the instruction a discriminating task; retain documented situation selection. |
| reference-skill | One reference is deliberately absent; the closing-rules reference is also supplied by the standing gate. | Resolve the absent-file and duplicate-prerequisite cases. |
| reference-standing | The skill gate still reads the same closing-rules path after deletion of the standing reference. | Classify the equivalent read behavior or separate the planted prerequisites. |
| tool-deny-bare | No offered-tools metadata reaches replayOnFollower, so the original cannot prove the WebFetch exclusion. | Supply offered-tool metadata; absence of calls is weaker evidence. |

### v4 remaining fake-runtime rulings

The isolated baseline at 59f4b083b reports the following 21 failures. The fake-runtime source was read again at 778b3a04d. The earlier reproduction details above still apply. No recorded stream or per-mutant case was added. All item names in this table have the prefix kill.fake.

| Items | Evidence and requested ruling |
|---|---|
| delete-instruction-1, delete-instruction-2, invert-instruction-1 | No spec is green on the original: runOnFake supplies no judge for judged criteria. Supplying the generic fake judge makes both original and mutant pass. Provide a meaningful judge contract and wire it, or exclude unsupported judged kills. |
| delete-guard-1, delete-register-2, delete-hazard-1, delete-hazard-2 | The original requires session/hazard state; runOnFake supplies no --states. Provide the declared states to the runner. |
| delete-gate-1, invert-gate-1 | No complete live spec: matching any line is a prose endpoint. Resolve the ordered-anchor ruling above. |
| delete-reference-1 | No complete live spec: the currency-table condition lacks an approved non-EUR situation. Provide that condition in the bank. |
| delete-script-1, delete-script-2 | The selected recorded streams omit the scripts, so the original fails its correctly generated script journey. Decide whether these tasks should use the estate-derived fake instead of those recordings. |
| delete-reference-2 | The selected invoice-match recording reads matching-rules on both copies. The fake chooses recordings by ask before consulting its estate-derived agent. Decide how recorded tasks participate in mutation measurement. |
| delete-gate-2 | The fake walks its declared step list, including verify then report, independently of the deleted prose gate. This behavior is equivalent for the tested trace. Decide whether to count that deletion as killable. |
| delete-route-2 | The standing routing table and the skill's trigger description still route the same task after the duplicate skill route is removed. Decide whether this deletion is equivalent. |
| delete-subagent-1, delete-subagent-2 | The recorded/derived dispatch is still allowed to name the helper; the trace remains green after its file is removed. Decide whether the fake should execute helper bodies or the item should cover only observable dispatch changes. |
| delete-tool-1 | The setting still allows Bash(python3 *) after the skill's declared Bash tool is removed. The trace is honestly green on both copies. Decide whether this permission deletion is equivalent. |
| delete-tool-2 | The invoice skill never edits amounts or other files, so declared Edit has no observed call on the original. Provide a task that actually exercises the declared tool. |
| delete-register-1, invert-register-1 | The recorded invoice answer retains its closing line on both copies. Decide how recorded replies can demonstrate a changed output rule without hand-authored mutant responses. |

### v4 scale measurement needing a ruling

The baseline passes 15/20 scale items. plan-1000 takes 46064 ms against a 6000 ms budget; plan-2500 and plan-5000 are not run after that failure. generate-2500 is killed at 75015 ms against a 15000 ms budget; generate-5000 is not run after it. These are wall-clock results on the owner's heavily loaded host, not proof of an algorithmic cause. Repeat the five items on an uncongested runner before deciding a product performance fix or changing any timing contract. The executor does not change budgets or validator tests.

### v4 continuation: five reviewer repros and product fixes

This section supersedes the earlier open rulings for ask approval, warning messages and command absence. The maintainer authorized the estate check implementation and focused tests under packages/checks; other checks files remain out of scope.

| Reviewer case | Executor branch result |
|---|---|
| Named prerequisite read after Edit, with other Reads early | Already fixed at 39007f52b. The named ordered selector fails while the original passes. |
| Named prerequisite absent, with generic Read before Edit retained | Already fixed at 39007f52b. Both the reference and named ordering checks fail. |
| Journey skill load absent, reference reads retained | Already fixed on the pre-change d068edb6d tree. The skill count fails. |
| Allowed command pattern replaced by an unrelated command under the same tool | Already fixed on the pre-change d068edb6d tree. Bash(python3 *) rejects the unrelated Bash command. |
| Permission request without a decision | Fixed at 6e311f263. Explicit system request and grant evidence must match call id, tool and input, in time order before the call. Missing records or timestamps stay inconclusive and gating. Denied, mismatched, late and ambiguous evidence cannot pass. |

The five probes use PR307's estate-derived fixture/follower from 7341a1169 with this branch's product. All five unmodified controls pass and all five violating traces fail. No validator file is edited. The scratch proof is /private/tmp/estate-v4-reviewer-five.json; this is a paired behavior probe, not a ladder claim.

- 6e311f263: approval regressions fail 5/21 before the fix, then pass 21/21. Ask compilation fails first, then passes. Existing estate checks 29/29, then 34/34 and generator 32/32 pass. Targeted types pass. Fixture complete count increases from 957 to 958; incomplete decreases from 344 to 343.
- 5f1b54e4e: guard_message checks deny, block, ask, warn and nudge interventions. The three warning/ask regressions fail before the fix, then all 4 tests pass; existing estate checks pass 29/29. Neutral allow remains inconclusive for this message check.
- bdfc60623: command_absent compiles its literal command to the existing some_call prohibition. Both regressions fail first, then pass 2/2; generator passes 32/32. The isolated seed 1 mutant.agent family rises from 38/44 to 39/44. The earlier instruction-no-force-push ruling diagnosis was incorrect: a fresh replay shows a push task, but the uncompiled custom predicate produced a judged criterion. The rule now has a machine check.

Focused seed 1 measurements at bdfc60623: gen.complete 84/97, gen.task 19/23, gen.coverage 21/25, mutant.agent 39/44. One-per-tool is resolved by approval compilation. Two measured bank items gained since d068edb6d. No new full-level or scale claim is made. PR307's input repairs are not merged into this worktree yet.
