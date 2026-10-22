# Generator bank audit status

The planner-v2 items and ladder version 2 landed in PR 959. Measurement machinery is not an independent pilot or audit under `docs/validators.md` sections 12.4 and 12.7. No seat has run on this bank here.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pending | Requires a fresh baseline and ten independent executor iterations on the merged planner-v2 bank. |
| cheater | pending | An independent helper must try shortcuts against the real generator and planner; builder mutation tests are not an audit. |
| cause review | pending | Candidate cause labels and historical builder counts are not independently reviewed distinct fixes. |
| planted bugs | pending | An independent helper must plant twenty defects in the real generator and planner, one at a time. |

The existing `journal.jsonl`, `SWEEP-JOURNAL.md` and `GATE.md` preserve earlier builder work. Their numbers do not establish a pilot of the current bank. A full measurement on the final integrated head is required before the lead dispatches seats; it must include the separate level-22 loader repair. No item, floor, ladder version or gate threshold is changed by this machinery.

## Measurement commands

Heavy runs go on GitHub only. Set `ROOT` to the absolute repository worktree path selected by the lead, and use an independent `train/audit-generator-<seat>-<n>` branch containing the measured head. The lead supplies `GH_PACE_BIN` as the absolute path of the paced wrapper. Every `gh` shell exports `PATH="$GH_PACE_BIN:$PATH"`, `LANE=audit-generator-<seat>` and `GH_PACED_APP=1`.

```sh
gh workflow run validators.yml --repo NexusGPT/driftbench --ref train/audit-generator-<seat>-<n> -f jobs=generator-measure-one
gh workflow run validators.yml --repo NexusGPT/driftbench --ref train/audit-generator-<seat>-<n> -f jobs=generator-measure
gh workflow run validators.yml --repo NexusGPT/driftbench --ref train/audit-generator-<seat>-<n> -f jobs=generator-measure-full
gh run download <run-id> --repo NexusGPT/driftbench -n generator-measurement-<mode> -D "$ROOT/measurement"
```

The three modes measure seed 1 alone, seeds 1–3 plus hidden, or seeds 1–20 plus hidden, respectively, in the same shards as pointer and variables. Each `generator-items-<mode>-<n>` artifact holds a raw shard. `generator-measure-row` joins every shard before counting items passing on every seed, then uploads `generator-measurement-<mode>` (mode is `one`, `standard` or `full`): the joined `generator-items.json`, `row.json`, a schema-checked iteration-0 journal at `validators/generator/journal.jsonl`, and `hardness.json`. The commit is recorded in the row; full reports also hold the canonical HEAD-derived hidden seed. A one-seed row is a probe, never a full gate baseline. The artifact's audit rows remain pending and its hardness gate must be red.

`baseline.ts --report <joined-report> --commit <measured-sha> --executor builder --journal-root <absolute-evidence-root>` writes a fresh iteration-0 row to a separate journal. It refuses to replace an existing baseline. It never resets the tracked historical journal. `measure-row.ts --before <before-report> --after <after-report> --iteration <n> --executor builder|blind --model <model> --commit <sha> --hypothesis <cause> --files <comma-list> --minutes <n> --tokens <n>` projects measured before/after reports to a schema-checked row; append it with `driftbench validate generator --journal <row.json>` on GitHub. Match seed labels across reports; hidden seed values follow each measured commit.

For a fresh pilot the lead preserves the historical journal and initializes the new pilot journal from the full iteration-0 artifact in a reviewed maintainer change. The builder's ten iterations and blind pilot's ten iterations keep separate executor counters. Blind rows leave `HANDOVER.md` untouched. No new version is needed: `GENERATOR_LADDER_VERSION` is already 2. No current generator item declares `role: catch`, so no catch list is invented; any future catch designation requires a reviewed item and pinned `catch.json` entry.

The lead keeps coverage notes outside the seat packet.

## Seat instructions

Each seat is a fresh helper with no tie to the builder, planner or generator implementation. Read only the intro, the four-row table and your numbered paragraph below. Do not open PR comments, the builder's `HANDOVER.md`, `SWEEP-JOURNAL.md`, `research.md` or other seats' work. Run commands from `ROOT`, the absolute repository worktree path at the common SHA supplied by the lead. Every check runs on GitHub. Write your verdict and evidence to your own result file for the lead; only your own row may subsequently be updated with that evidence. A missed bug or successful cheat is a proposed new item, never an audit-seat bank edit.

1. Blind pilot seat. Starts with only `pnpm driftbench validate generator --brief --fresh`, captured on GitHub at the common head. Runs ten iterations on its own `exec/` branch, one product cause per iteration in the generator or planner, never a bank edit. Uses `generator-measure-one` and `generator-measure` for diagnosis. The iteration-0 baseline and all ten recorded gate rows use `generator-measure-full`, preserving one seed-label cohort; never compare a full baseline with a one-seed or three-seed row. Produces ten rows with `measure-row.ts --executor blind` and appends them on GitHub; `HANDOVER.md` stays untouched. Check `driftbench validate generator --hardness --json`. Requires ten rows, at least one item fixed, at least 100 distinct failing causes, and the recorded generator bar in `GATE.md` (forecast at least 50, score at most 0.67; default contract 100 and 0.4 otherwise). The other seats remain pending until independently recorded.
2. Cheater seat. Starts from the same fresh brief and a `generator-measure-full` baseline. Tries fixed seeds, reading oracles, matching item ids, fixture-name special cases, returning what checks ask for and brute-force counts without making the generator or planner correct. Edits only product code under the absolute worktree's generator/planner source paths on scratch branches, never validator code. Compare before/after passing item ids and scores from matching measurement artifacts. Any gain fails the seat; each successful cheat becomes a proposed new bank item.
3. Cause review seat. Starts from the joined full artifact with causes and trailing `Fix:` hints removed before it is handed over (the lead uses the shared `--blind` report view or equivalent recursive stripping). Samples thirty failing items uniformly from the complete pool of failing items across all levels, without steering to any level or family. Writes the fix for each before reading builder tags. Report agreement (must be at least 0.8) and the independently reviewed number of distinct fixes (the gate requires at least 100); thirty samples alone do not prove that count. Composite checks are excluded from distinct-cause credit. Missing cause tags stay visible as a finding, never invented evidence.
4. Planted bugs seat. Starts from `generator-measure-one`. Plants twenty known independent defects, one at a time, in product code under the absolute worktree's generator/planner source paths. Each mutation is measured on GitHub against the unchanged bank. Every defect must lose at least one item, with the lost ids recorded. Restore each mutation before the next. A defect that loses no item fails the seat and becomes a proposed new item.


The shared hardness command reads this file; `driftbench validate generator --hardness` remains red until all four rows read `pass` and the pilot and bank conditions hold. The lead dispatches the seats; this PR runs none.
