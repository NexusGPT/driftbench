# Generation completion rulings

Basis: origin/main at 6bf475944, seed 1. The executor's claims are read from
origin/exec/estate-v3 at f3fb8b496. Product source is unchanged by this ruling.

The original bank reproduces the fourteen reported failures. One demand is valid
as written, three items have defective inputs or an absent observation contract,
and ten have gaps in the derived follower or situation membership.

Paths below are relative to `packages/`. Every row names an executable proof in
`validators/test/estate/rulings.test.ts`. Its reference is the actual main product
plus the bounded test-only compiler/check changes described below. G/R/G means the
item passes that reference, fails a locally planted compiled-output deletion
mutant, then passes after restoration. No mutant is passed to the follower.

| Item suffix under `gen.complete` | Ruling | Evidence and retained demand | Proof (G/R/G) |
|---|---|---|---|
| guard_negative-guard-reply-length-py | VALID AS WRITTEN | `generate/src/estate/then.ts` negative branch must distinguish warning from ordinary allow invocation. The rendered length guard warns with exit 0. A correct compiler counts warnings, never every Stop invocation. | Delete guard expectation. |
| guard_register-guard-read-before-edit-py | FIXTURE GAP | `validators/src/ladders/estate/follower.ts` formerly omitted guard output. Execute the rendered script with the actual payload; `checks/src/checks/estate.ts` guardMessage can then judge its text. | Delete guard_message. |
| guard_register-guard-reply-length-py | FIXTURE GAP | Same absent output. The length script warns, it does not block. `guardMessage` must support warning interventions; inventing a blocking verdict would falsify the fixture. | Delete guard_message. |
| hazard_recovery-hazard-after-compaction | FIXTURE GAP | `pipeline.ts` formerly discarded the stimulus event. The follower now emits compact_boundary after a standing read, then derives recovery rereads from estate rules. | Delete hazard_recovery. |
| journey-route-table | ITEM DEFECT | `render.ts` deliberately omits a required reference to test lint. Complete positive journeys cannot read it. `generationRun` supplies that same file in a twin; the lint plant remains absent. | Delete reference checks and ordered read checks; separately omit routed skill loading. |
| read_when-reference-skill | ITEM DEFECT | Same absent reference. The generation twin retains its atom, path, scope and positive read demand. | Delete reference checks. |
| read_when-reference-standing | FIXTURE GAP | The task claimed `.claude/steps.json` but never read it. The follower reads it and replay supplies rendered reference paths to the adapter. | Delete reference checks. |
| skip_pressure-gate-fixed-gate | FIXTURE GAP | `situations.ts` claimed a skill-scoped gate on another skill's task. Only the owning skill's pressure situation now claims it; the prerequisite read remains mandatory. | Separately omit the named file while retaining generic Read-before-Edit, and move only the named read after Edit. Both are rejected. |
| stage_anytime-stage-anytime | FIXTURE GAP | `follower.ts` walkOf formerly discarded every anytime step. It now emits each declared anytime step alongside the walk. | Delete stage_seen. |
| stage_order-stage-anytime | FIXTURE GAP | Same discarded step; the correct compiled check tests reachability without imposing an order. | Delete stage_seen. |
| tool_boundary-tool-allow | FIXTURE GAP | `situations.ts` attached all permissions to tasks that never called them. Dedicated situations derive calls from the estate permission rules. | Delete permission; separately broaden the allowed command pattern to its bare tool. |
| tool_boundary-tool-declared | FIXTURE GAP | Same mismatch for declared tools. Situations derive each tool from the skill or helper declaration and invoke its owning skill or helper. Ownership follows declaration order and survives helper renaming. | Delete permission or owner participation checks. |
| tool_boundary-tool-ask | ITEM DEFECT | `docs/estate.md` section 5 explicitly leaves ask as a gap. The old fixture supplies no approval observation at all. A synthetic fixture contract now makes the demand observable; production compiler/check support remains required. | Delete permission; separately require a request without a decision. Missing-request and missing-decision counterexamples are independent. |
| tool_denied-tool-deny | FIXTURE GAP | The correct bare-tool exclusion in `then.ts` cannot be proved from absent offered metadata. The follower now emits init.tools derived from estate declarations and denials. | Delete tools_offered. |

## Reference and product boundary

The reference in `rulings.test.ts` keeps production scanning, planning, generation,
parsing, mapping and checks except for five narrow gaps:

- A negative length-guard expectation filters `warn` instead of counting ordinary
  allow invocations. `then.ts` owns this compiler correction.
- A reference `guard_message` check judges nonempty stdout/stderr from warnings as
  well as denials. `checks/src/checks/estate.ts` owns production support.
- A reference fixed-gate compiler uses `Read~<required path>` before `Edit`, instead
  of generic `Read` before `Edit`. The real compiler currently accepts the named
  prerequisite after the edit when another read occurs earlier.
- A reference compiler emits `custom.permission` for ask, and a reference decoder
  verifies that a matching request and allow decision precede every protected call.
  `generate/src/estate/then.ts` and `checks/src/checks/estate.ts` own production support.

- A reference declared-tool compiler requires the skill or helper owning the declaration
  to participate. The source provenance identifies that owner.

The permission records are **synthetic fixture telemetry**, not observed Claude
Code telemetry and not a promise made by `docs/estate.md`. They are system records:
`permission_request` carries requestId, tool and input; `permission_decision` carries
the same requestId and decision. The requestId equals the protected tool-use id.
The adapter preserves these records in `raw.kept`. Its transport is already present;
its presence does not mean the product implements approval checking. The follower
emits the records from `permissions.ask` and each actual matching call, without
reading test ids, expectations or product mutant state. Removing that permission
from the input estate removes the records.

The real main product, with the repaired fixture, still fails exactly the negative
length-guard, warning-message, fixed-prerequisite ordering, ordinary scoped-gate
ordering, ask-permission and declared-tool owner-participation items on seed 1. The ordinary gate is the same named-file
ordering defect exposed by applying the mechanism across its semantic class. This PR does not
mark those production capabilities implemented.

## Component mechanism

`completion-contract.ts` builds the expected assertion structure from the generated
spec and its source evidence. Required source clauses survive a generator that
omits them: skill routes, file reads, scoped prerequisites, permission patterns,
guard intervention, stages, hazards and situation workspace outcomes. The harness
contains no bank item names, fixture names or hidden atom identifiers.

`completion.ts` visits that structure by check type. It expands finite count bounds,
selectors, positive and negative membership, workspace clauses, ordered pairs,
permission clauses, guard-message clauses and recovery clauses. Universal clauses
use conforming collections with at least three members, then invalidate the first,
interior and last member separately. This is a finite witness basis, not a proof
for arbitrarily long traces or arbitrary checker programs.

The bank first retains its full-spec conforming replay. For each derived component
it then projects the actual product output onto the inspected check. This prevents
an unrelated check from masking a missing assertion, while keeping the input
trace and all other observation channels. A prepared conforming control must pass,
and its one-component violating trace must fail. Missing checks cannot pass this
pair: both projected replays pass and the item reports the unchallenged component.
Every component is exercised on a passing reference item; a derivation gap makes
the item fail with the gap's name.

Guard-message witnesses keep other messages valid. Forbidden-call witnesses keep
the offered list compliant. Recovery safety witnesses retain the event and
resumption. Required-file presence and order have separate witnesses; other Reads
stay early in the order witness. Request, decision, identity, allowed outcome and
time relations have separate permission witnesses. None of these observations
executes a command or sends a message. This revision also repairs tool situation
ownership: the follower dispatches the helper whose declaration supplies the tool,
with its declared brief fields. It receives no product-mutant state. The regression
test renames and reorders helpers on seeds 1, 7 and 19, preserving their references.

The structural product-output deletion proof is generated from the enumerated
check keys. The historical seven reviewer regressions are additional proof cases,
not dispatch branches in the component generator. All seven go red, with green
controls and green restoration: omitted routed skill, omitted named file, broadened
command pattern, request-only approval, first-intervention-only guard checking,
omitted no-call assertion, and omitted recovery collateral verdict. The independent
late-prerequisite observation still exposes the unchanged real product.

Bank identifiers, count, levels and thresholds are unchanged. No product file,
floor, other validator or executor branch is changed.

## Component coverage

Seed 1, bounded reference described above. Counts are component witness occurrences
summed across each item's generated specs (319 total), including each quantifier position and
workspace assertion. They are not unique capability counts. All entries below have
passing conforming controls and rejecting violating traces. The machine-generated
inventory is `GEN-COMPLETE-COMPONENTS.json`.

| Item suffix under `gen.complete` | Specs | Component witnesses | Derivation gaps |
|---|---:|---:|---:|
| guard_negative-guard-reply-length-py | 1 | 4 | 0 |
| guard_register-guard-read-before-edit-py | 1 | 10 | 0 |
| guard_register-guard-reply-length-py | 1 | 9 | 0 |
| hazard_recovery-hazard-after-compaction | 1 | 12 | 0 |
| journey-route-table | 6 | 48 | 0 |
| read_when-reference-skill | 5 | 40 | 0 |
| read_when-reference-standing | 2 | 12 | 0 |
| skip_pressure-gate-fixed-gate | 1 | 8 | 0 |
| stage_anytime-stage-anytime | 1 | 5 | 0 |
| stage_order-stage-anytime | 13 | 65 | 0 |
| tool_boundary-tool-allow | 4 | 30 | 0 |
| tool_boundary-tool-declared | 3 | 28 | 0 |
| tool_boundary-tool-ask | 1 | 32 | 0 |
| tool_denied-tool-deny | 3 | 16 | 0 |

Named derivation gaps outside the shapes present in these fourteen reference items:

- Arbitrary regex witness synthesis in `guard_message.mustNot`.
- Tool input assertions and closed-input clauses, plus unrecognized entry fields.
- Ordered alternatives, stage/skill endpoints, key equality, compaction reset and
  cross-block history. The current named-file pair uses simple tool endpoints.
- Recovery resumption when an obligatory reread implies resumption: a trace cannot
  violate resumption alone while retaining that reread. This is reported as coupled.
- Unknown expectation/custom-check structures and multi-block component isolation.

These are explicit fail-closed gaps when encountered. The tests inject unsupported
regex, ordered and custom-check shapes and assert their gap names. No coverage of
those shapes is claimed by the zero-gap entries in the table.

## Validation

Run one file at a time, with `--maxWorkers=1 --testTimeout=600000`:

- `packages/validators/test/estate/rulings.test.ts`: reference, deletion mutants,
  restoration, preserved lint defect and estate-derived permission metadata.
- `packages/validators/test/estate/follower.test.ts`: derived follower behavior.
- `packages/validators/test/estate/oracles.test.ts`: production registry and existing
  oracle mutation checks.
- `packages/validators/test/estate/generator.test.ts`: deterministic fixtures and
  generated estate invariants.

Observed results after the component correction: rulings 9/9, follower 7/7,
generator 8/8 and oracles 20/20. The regenerated visible and holdout fixtures match
the generator byte for byte.
The targeted TypeScript check and Biome check of changed TypeScript files pass.
No ladder sweep or timing claim is made.

## Review corrections

The owner-dispatched review of 7341a1169 reports FAIL in PR 307 comment
6154377549. Its four narrower mutants exposed independent demands masked by the
original broad deletions. The additional late-file trace exposes a real compiler
error. All five now have focused regression evidence in `rulings.test.ts`:

| Demand | Reference | Product mutant or current product | Restored reference |
|---|---|---|---|
| Routed skill load | Green | Omit only skill expectation: red item | Green |
| Named prerequisite file | Green | Omit file demand, keep generic ordering: red item | Green |
| Allowed command pattern | Green | Broaden pattern to bare tool: red item | Green |
| Approval decision | Green | Request-only checker: red item | Green |
| Named prerequisite before Edit | Green | Current generic ordering accepts late read: red item | Green |

Only the owner-dispatched reviewer satisfies the independent review gate. The
previous author-dispatched PASS comment does not satisfy it. No merge is authorized.
Independent review of the corrected head remains required.

The owner-dispatched re-review of 99b6b66f8 confirms the earlier fixes but finds
three further survivors. This revision replaces the per-demand counterexample
selector with the structural component mechanism above. Only the owner-dispatched
reviewer may accept this head. Later groups remain paused.
