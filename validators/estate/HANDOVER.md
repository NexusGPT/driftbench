# Handover: validator estate

Rewritten by the executor every iteration (docs/validators.md section 10). A stranger continues from this file alone. The level table is written by `driftbench validate estate --journal <row.json>` from the last journal row.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
<!-- level-table:end -->

No executor iteration has run yet, so the table is empty. The lane that built the validator ran `pnpm driftbench validate estate --seeds 1..20 --hidden` and reached level 3 of 7 on seeds 1 to 20 and on the hidden seed. Levels 4 to 7 were also computed outside the ladder, on seeds 1 to 20 (the ladder stops at level 4):

| Level | Value on seeds 1 to 20 | Threshold |
|---|---|---|
| 1 atoms and edges | 1 on every seed | 1 |
| 2 lint | 1 on every seed | 1 |
| 3 plan | 1 on every seed | 1 |
| 4 generated specs | 0.4429 to 0.5551 | 1 |
| 5 agent mutants | 0 on every seed (the lowest kind) | 0.9 |
| 6 estate mutants | 0.9957 to 0.9971 | 1 |
| 7 holdout estate | 0.5 on every seed (levels 1 to 3 hold on the holdout estate) | 1 |

## Floor

See `validators/floors.json`; `pnpm driftbench validate floors` prints it. The estate has no floor yet (0). Level 3 holds on seeds 1 to 20 and the hidden seed; raising the floor to 3 is a maintainer commit of its own with a `--json` run as evidence.

## Open items

Level 4 on seed 1, 11 items, each with the file it points at:

* `gap:needs-some-call-check` (packages/checks/src/checks/tools.ts): 138 specs. A predicate asks for one call with given input (a Read of a file, a Bash command holding a script name, an Agent dispatch of a helper), and the tools check asserts input on every call.
* `gap:needs-registered-check` (packages/checks/src/checks/custom.ts): 124 specs. Custom predicates no check runs: `permission`, `run_config`, `hazard_recovery`, `command_absent`, `grounded_values`, `brief_fields`, `helper_read_only` and others.
* `same-phrase:route_positive` (packages/generate/src/estate/generate.ts): the k positive asks of a route all take the first phrase of the shuffled bank, so three planned asks are one ask.
* `gap:needs-stage-reach-check` (packages/checks/src/checks/stage.ts): an anytime step has no reach check; every pairwise row on it waits.
* `gap:needs-static-runner` (packages/estate/src/lint/lint.ts): invariant specs wait for a static runner.
* `gap:needs-guard-timing` and `gap:needs-guard-message-check` (packages/adapters/src/claude-code/session.ts): the trace holds no guard time or message.
* `gap:needs-negation` (packages/generate/src/estate/then.ts): an ordered pair and a tool_not_called have no negative control.
* `gap:needs-approved-phrase` and `gap:needs-workspace-outcome` (packages/estate/src/plan/contract.ts): the plan asks an outside_trigger row for a rule that applies always; no ask can be outside it, and the bank the validator writes holds every situation that exists.
* `follower:guard_negative:guards` (packages/generate/src/estate/then.ts): a guard with no registry row has no verdict in its evidence, so the negative control asks that it never fires; a guard on an event every turn has (a prompt, a stop) fires with allow. Seen on the seeds where the planted row-less guard is one of those.

Behind level 4, computed directly: level 5 lives on references, scripts, gates (an ordered pair with no key is met by any Read before the Edit), hazards, custom tool rules, register rules judged by a criterion (not run offline), and the helper's contract_alone spec (it checks only the workspace). Level 6 names the tests maintenance regenerates when their atom under test left the estate, because the test also names the skill or helper that owns the atom (packages/estate/src/maintain/impact.ts retires a test only when all its atoms left).

## Hypotheses tried

None yet: no executor iteration has run. Each entry: the hypothesis, the evidence, and why it was rejected.

## Next actions

1. Close `gap:needs-some-call-check`: a "some call matches" form of the tools check (or a custom check registered in the replay runner) and the matching mapping in packages/generate/src/estate/then.ts. It completes the largest group of specs on every seed.
2. Give `route_positive.<atom>.<n>` rows the n-th phrase of the shuffled bank in packages/generate/src/estate/generate.ts, so the k positive asks differ (`same-phrase:route_positive`).
3. Run `pnpm driftbench validate estate --seeds 1..20 --hidden`, record the level per seed with `--journal`, and read the next items of level 4.

## Pitfalls

* The ladder stops at level 4, so levels 5 to 7 print "not run". Their functions (`agentMutantLevel`, `estateMutantLevel`, `holdoutLevel` in packages/validators/src/ladders/estate/levels.ts) run directly on `estateRun(seed)` for a look ahead; never change a threshold to reach them.
* The rule follower (packages/validators/src/ladders/estate/follower.ts) obeys every atom of the situation its ask belongs to; a complete spec it fails is a wrong expectation of the generator, not a follower defect. A change to the follower changes the fixtures (see Fixtures).
* The phrase bank is complete by construction: every situation the estate has carries approved phrases and declared paths. A spec still waiting for a phrase points at a row the plan should not ask.
* The prose atoms come from a recording the renderer writes (what a correct splitter answers), so level 1 measures the code path from an answer to an atom; the validator calls no model.
* One seed takes about one second for levels 1 to 4, two more for level 6 and three for the holdout estate.

## How to run

```
pnpm driftbench validate estate --seeds 1..20 --hidden
pnpm driftbench validate estate --seed 1 --json
pnpm driftbench validate estate --brief
```

The ladder must be registered in packages/validators/src/ladders/index.ts (`estate: estateLadder()`), a maintainer change.

## Fixtures

* `packages/validators/fixtures/estate/seed-1.yaml` and `holdout-1.yaml`: the rendered estate of seed 1 in each profile (every file), the truth (atoms with hidden id, kind, line and key; edges; lint findings), the recorded splitter answers, and the rule follower's session for the first ask of every trigger situation. `fixtureText(1, profile)` in packages/validators/src/ladders/estate/fixture.ts writes them; a test compares them byte for byte.
* No file for the other seeds: each run draws its estate from the seed and writes it to a temporary folder, removed after the scan.
