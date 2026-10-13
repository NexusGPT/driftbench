# Handover: validator estate

Continue on `exec/estate-v3`, draft PR 154, in `.worktrees/exec-estate-v2`. Main is merged at `7cc677ae` before this run. Never edit the validator or bank.

## Level per seed

<!-- level-table:start -->
| Seed | Level |
|---|---|
| 1 | 0 |
<!-- level-table:end -->

Iteration 26: seed 1 passes 955 of 1170 items. The fresh post-main baseline passes 955 of 1170. The supplied last-known count was 956; the old handover records 952. The fresh baseline gains only wide-folder, generate-1000 and generate-2500 timing items over that handover. Timing changes receive no component credit.

Current capture: `.cache/estate-executor/codex-26.json`. Source stamp and patch: `codex-26-source.json` and `codex-26.patch` in that folder. Captures are local and are not in a fresh clone. The source is held unchanged throughout each measurement.

The separate `.cache/estate-executor/codex-26-seeds.json` sweep runs visible seeds 1 to 20 and hidden seed 94381550. It stops at the first failing level. It proves the reader results and level 0 across those seeds, not an all-level bank score across seeds.

| Sweep seed | Level |
|---|---|
| 1 | 0 |
| 2 | 0 |
| 3 | 0 |
| 4 | 0 |
| 5 | 0 |
| 6 | 0 |
| 7 | 0 |
| 8 | 0 |
| 9 | 0 |
| 10 | 0 |
| 11 | 0 |
| 12 | 0 |
| 13 | 0 |
| 14 | 0 |
| 15 | 0 |
| 16 | 0 |
| 17 | 0 |
| 18 | 0 |
| 19 | 0 |
| 20 | 0 |
| hidden | 0 |

## Floor

No estate floor is registered in `validators/floors.json`. The ladder remains level 0. Floors and protected files are unchanged by this executor.

## Open items

Seed 1, all levels, from the current capture:

| Level | Passing |
|---|---|
| reader | 582/641 |
| lint | 45/46 |
| plan | 44/65 |
| generation | 196/270 |
| agent-mutants | 22/75 |
| maintenance | 49/53 |
| scale | 17/20 |

| Failing family | Items |
|---|---|
| unit.runner | 41 |
| kill.fake | 31 |
| mutant.agent | 22 |
| plan.relevance | 20 |
| gen.complete | 14 |
| gen.task | 9 |
| scan.standing | 9 |
| scan.gates | 8 |
| scan.steps | 7 |
| scan.decoys | 6 |
| gen.coverage | 5 |
| scan.hostile | 5 |
| gen.asks | 4 |
| scan.hazards | 4 |
| scan.paths | 4 |
| blind.edges | 3 |
| maintain.impact | 3 |
| scale | 3 |
| scan.reference-prose | 3 |
| scan.catalogue | 2 |
| scan.combination | 2 |
| scan.dispatcher | 2 |
| scan.registry | 2 |
| blind.gates | 1 |
| blind.lint | 1 |
| gen.reads | 1 |
| lint.defect | 1 |
| maintain.fixture | 1 |
| plan.contract | 1 |

First failing level, reader, exact unresolved ids:

- `scan.registry.md-label-lowercase`: `packages/estate/src/scan/claude-code.ts`.
- `scan.registry.json-enforces-objects`: `packages/estate/src/scan/claude-code.ts`.
- `scan.steps.process-array`: `packages/estate/src/scan/claude-code.ts`.
- `scan.steps.keyed-by-id`: `packages/estate/src/scan/claude-code.ts`.
- `scan.steps.next-string`: `packages/estate/src/scan/claude-code.ts`.
- `scan.steps.then-key`: `packages/estate/src/scan/claude-code.ts`.
- `scan.steps.nested-workflow`: `packages/estate/src/scan/claude-code.ts`.
- `scan.steps.comments`: `packages/estate/src/scan/claude-code.ts`.
- `scan.steps.trailing-commas`: `packages/estate/src/scan/claude-code.ts`.
- `scan.catalogue.guard-command-key`: `packages/estate/src/scan/claude-code.ts`.
- `scan.catalogue.rules-objects`: `packages/estate/src/scan/claude-code.ts`.
- `scan.dispatcher.change-folder`: `packages/estate/src/scan/code.ts`.
- `scan.dispatcher.shell-wrapper`: `packages/estate/src/scan/code.ts`.
- `scan.reference-prose.text-file`: `packages/estate/src/scan/claude-code.ts`.
- `scan.reference-prose.chained`: `packages/estate/src/scan/claude-code.ts`.
- `scan.reference-prose.outside-skill`: `packages/estate/src/scan/claude-code.ts`.
- `scan.gates.markdown-link`: `packages/estate/src/scan/code.ts`.
- `scan.gates.two-on-one-line`: `packages/estate/src/scan/code.ts`.
- `scan.gates.decoy-example`: `packages/estate/src/scan/code.ts`.
- `scan.gates.then-form`: `packages/estate/src/scan/code.ts`.
- `scan.gates.without-form`: `packages/estate/src/scan/code.ts`.
- `scan.gates.only-after-form`: `packages/estate/src/scan/code.ts`.
- `scan.gates.question-form`: `packages/estate/src/scan/code.ts`.
- `scan.gates.prior-to-form`: `packages/estate/src/scan/code.ts`.
- `scan.hazards.status-429`: `packages/estate/src/scan/code.ts`.
- `scan.hazards.reboot`: `packages/estate/src/scan/code.ts`.
- `scan.hazards.resumed`: `packages/estate/src/scan/code.ts`.
- `scan.hazards.decoy-price`: `packages/estate/src/scan/code.ts`.
- `scan.paths.backslashes`: `packages/estate/src/scan/code.ts`.
- `scan.paths.line-number`: `packages/estate/src/scan/code.ts`.
- `scan.paths.project-dir`: `packages/estate/src/scan/code.ts`.
- `scan.paths.wiki-link`: `packages/estate/src/scan/code.ts`.
- `scan.combination.colon+crlf`: `packages/estate/src/scan/claude-code.ts`.
- `scan.combination.prefixguard+crlf`: `packages/estate/src/scan/claude-code.ts`.
- `scan.hostile.hooks-wrong-shape`: `packages/estate/src/scan/claude-code.ts`.
- `scan.hostile.prompt-hook`: `packages/estate/src/scan/claude-code.ts`.
- `scan.hostile.duplicate-names`: `packages/estate/src/scan/claude-code.ts`.
- `scan.hostile.helper-subfolder`: `packages/estate/src/scan/claude-code.ts`.
- `scan.hostile.tabs-in-frontmatter`: `packages/estate/src/scan/claude-code.ts`.
- `scan.decoys.owner-table`: `packages/estate/src/scan/code.ts`.
- `scan.decoys.changelog-reference`: `packages/estate/src/scan/code.ts`.
- `scan.decoys.form-number-label`: `packages/estate/src/graph/edges.ts`.
- `scan.decoys.guard-message-overlap`: `packages/estate/src/graph/edges.ts`.
- `scan.decoys.script-name-in-prose`: `packages/estate/src/scan/code.ts`.
- `scan.decoys.hazard-in-example-quote`: `packages/estate/src/scan/code.ts`.
- `scan.standing.linked-file`: `packages/estate/src/scan/code.ts`.
- `scan.standing.slash-command`: `packages/estate/src/scan/code.ts`.
- `scan.standing.skill-first`: `packages/estate/src/scan/code.ts`.
- `scan.standing.no-outer-pipes`: `packages/estate/src/scan/code.ts`.
- `scan.standing.list-item`: `packages/estate/src/scan/code.ts`.
- `scan.standing.sentence`: `packages/estate/src/scan/code.ts`.
- `scan.standing.heading-per-skill`: `packages/estate/src/scan/code.ts`.
- `scan.standing.nested-standing`: `packages/estate/src/scan/claude-code.ts`.
- `scan.standing.imported-standing`: `packages/estate/src/scan/claude-code.ts`.
- `blind.gates.decoy-never-read-before`: `packages/estate/src/scan/code.ts`.
- `blind.lint.emoji-count-as-characters`: `packages/estate/src/lint/lint.ts`.
- `blind.edges.next-edges-four-steps`: `packages/estate/src/scan/code.ts`.
- `blind.edges.next-edges-direction`: `packages/estate/src/scan/code.ts`.
- `blind.edges.dispatch-plain-name`: `packages/estate/src/scan/code.ts`.

## Hypotheses tried

### Iteration 26

955/1170 to 955/1170.

Question: Why do recognized gate acts retain prose instead of runtime tool labels? The act recognizer includes update and rename, but actLabel omits them and several existing gerunds. Normalize those spellings in the runtime-label mapping. Preserve the four gate forms and existing controls. Seven tests fail before the change; nine pass afterwards, with 23 related assertions passing.

- Sources: docs/adapters/claude-code.md: tool labels for generic acts; packages/estate/src/scan/code.ts: ACT_VERBS and actLabel; packages/estate/test/scan/pilot.test.ts: fixed gate forms.
- Gains: scan.gates.act-update, scan.gates.act-rename.
- Losses: scale.generate-1000, scale.generate-2500.

Older iterations and research remain in the append-only journal. The pre-takeover and previous full sweeps are historical measurements on different source versions, not current branch results.

## Next actions

1. Fix the borderless markdown-table cause in the largest remaining reader family, scan.standing. The prepared table-borders test is red.
2. Re-measure seed 1 and visible plus hidden reader seeds, journal and commit that separate cause.
3. Re-rank the reader failures. The gate reader still takes only one match per line.

## Pitfalls

- No model calls. All regression estates are fictional. Use `vitest --maxWorkers=2` and one validator sweep at a time.
- `validators/estate/research.md` was already modified at takeover. Preserve it and exclude it from executor commits. Record new research in the permitted journal and this handover.
- `packages/estate/test/scan/object-rules.test.ts` was already untracked. Its 11 cases fail because object-valued enforces entries are discarded. Preserve this prepared work; it is not a completed fix or part of these commits.
- `unit.runner` passes YAML core specs to the native JSON unit runner and omits generated native unit JSON. Its 41 failures include that previously diagnosed contract mismatch. Do not change the product to conceal it.
- `plan.relevance.helpers-running` conflicts with the documented allowed covering-array tuples. Other relevance policies need their own review. Do not add undocumented target-kind masks.
- Gates beyond the four documented forms, routing outside tables and extra standing-file sources have unresolved contract conflicts in `NEEDS.md`. Keep them distinct from component defects.
- `kill.fake` uses a stand-in that recognizes fixture proof asks. It is not evidence that arbitrary generated asks must be rewritten to match that private vocabulary.
- PRs 119, 124, 133, 140 and 147 already arrived through main. Their portability and oracle fixes are maintainer work, not new executor gains. Do not duplicate them.
- Timing failures vary with machine load and stay in each captured score. The TypeScript launcher already uses Node with a local loader for long temporary paths.

## How to run

```sh
pnpm -s driftbench validate estate --seed 1 --items --all-levels --json
pnpm -s driftbench validate estate --seeds 1..20 --hidden --json
pnpm -s driftbench validate estate --seeds 1..20 --hidden --items --all-levels --json
pnpm -s driftbench validate estate --brief --fresh
pnpm -s driftbench validate estate --check-handover
pnpm exec vitest run packages/estate/test/scan/gate-act-names.test.ts --maxWorkers=2
```

The first command measures every bank item on seed 1. The second measures levels until the first failure on every seed. The third is the full all-level sweep; run it alone. Research is in each journal row because this executor cannot edit `research.md`.

## Fixtures

- `packages/validators/fixtures/estate/seed-1.yaml` and `holdout-1.yaml` hold generated fictional estates.
- Bank generators under `packages/validators/src/ladders/estate/bank/` create planted inputs in temporary folders. Read them to diagnose; never edit them.
- `examples/estates/fixture` and `fixture-v2` hold the committed fictional estate and its recorded answers.
- New regression tests are under `packages/estate/test/scan/`. Their fake ports make no model calls.
