# Judges v3 provisional hardness bar

The expanded bank adds all nine requested statistical capabilities before this
measurement. The original section 12 gate remains **not met**. The owner permits
a normal PR with a measured provisional lower bar; this is a delivery exception,
not a claim that the original hardness or independent audit passes.

## Measured stub pilots

Checkpoint: `6579b72536697bc99bccb5c138d007d4e3a4a44d`; hidden seed:
`703475557`. Both executors start with fourteen unimplemented scoring/replay
functions and receive only public contracts and stripped failing-item feedback.
Each completes ten actual source-changing rounds after baseline on seeds 1–20
and the hidden seed. The bank and HEAD stay fixed throughout.

| Measure | Builder | Blind | Original bar |
|---|---:|---:|---:|
| Baseline passing | 0/334 | 0/334 | measured |
| Passing after ten repairs | 327/334 | 327/334 | score at most 0.4 |
| Bank score | 0.979041916168 | 0.979041916168 | at most 0.4 |
| Level | 3/5 | 3/5 | separate from bank score |
| Items gained per round | 32.7 | 32.7 | positive |
| Remaining items | 7 | 7 | measured |
| Linear forecast | 0.214067278287 | 0.214067278287 | at least 100 |
| Author cause tags remaining | 7 | 7 | at least 100 independently reviewed causes |

The independent final reviewer covers all seven failures and identifies two
**inferred capability repair groups**: the exact permutation API and sample
planner. Their implementation root-cause count remains unestablished. Seven
item tags are not seven proven independent repairs. The review matches all
seven proposed repairs to their tags, but cannot sample thirty final failures
or establish one hundred causes. The separate baseline diagnostic matches
22/30 tags exactly (0.7333); it does not replace the final population.

## Provisional per-version bar

Max score after the pilot: 0.98

Min forecast: 0.2

These are provisional delivery thresholds for judges version 3 only: the
smallest score ceiling to two decimals and largest forecast floor to one
decimal that these measurements meet. No lower distinct-root-cause threshold
is asserted: the independent review cannot establish that count. The original
cause requirement and audit therefore remain unmet, and `--hardness` continues
to exit 1. Version 2's default, bank, evidence and floor remain unchanged.

Reason: the requested capabilities are implemented through a small set of
shared scoring functions. Nominal scoring and replay alone clear 300 items;
ten complete capability repairs clear 327. Adding repeated cases or splitting
one algorithm into partial repairs would inflate the item/round count without
measuring more independent work. The bank has 43 author-declared groups before
the pilot, including shared groups, and does not claim 334 independent causes.

The forecast is remaining items divided by average item gain. It is not an
estimate of the effort needed to implement the two remaining APIs. The
production implementation already supplies both; the incomplete pilot
candidates remain preserved as measurement evidence.

## Retained limitations

- The original finished-code experiment, the 300-item two-repair climb, and a
  broad-batch implementation experiment are excluded from this forecast.
- Both broad-batch executors reach 334/334 in one source change, but bundle
  independent APIs. Their history is retained without inventing intermediate
  repairs. Fresh one-cause-per-round executors produce the measurement above.
- Codex substitutes for unavailable Sonnet. Procedural isolation is not an
  operating-system security boundary.
- The blind pilot discloses a corrected handwritten test, a commit submitted
  before its green process returned, and incomplete end-to-end timing for its
  earliest rounds. All eventual regression outcomes and snapshots are retained.
- During round ten, the public alpha contract clarifies that `pairable` counts
  retained ratings. Both executors receive the same clarification before their
  alpha measurement. No bank or production source changes during the pilot.

Full evidence: [pilot protocol](PILOT.md), [journal](journal.jsonl),
[pilot measurements](pilot.json), [independent audit](audit.md).
