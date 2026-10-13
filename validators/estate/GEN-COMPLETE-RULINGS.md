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
| tool_boundary-tool-declared | FIXTURE GAP | Same mismatch for declared tools. Situations derive each tool from the skill or helper declaration and load its owning skill where applicable. | Delete permission. |
| tool_boundary-tool-ask | ITEM DEFECT | `docs/estate.md` section 5 explicitly leaves ask as a gap. The old fixture supplies no approval observation at all. A synthetic fixture contract now makes the demand observable; production compiler/check support remains required. | Delete permission; separately require a request without a decision. Missing-request and missing-decision counterexamples are independent. |
| tool_denied-tool-deny | FIXTURE GAP | The correct bare-tool exclusion in `then.ts` cannot be proved from absent offered metadata. The follower now emits init.tools derived from estate declarations and denials. | Delete tools_offered. |

## Reference and product boundary

The reference in `rulings.test.ts` keeps production scanning, planning, generation,
parsing, mapping and checks except for four narrow gaps:

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
length-guard, warning-message, fixed-prerequisite ordering and ask-permission items
on seed 1. This PR does not
mark those production capabilities implemented.

## Mutation evidence

Completion checks a conforming trace and separate counterexamples for each demand.
Counterexamples are selected from the source atom and plan, not generated Then.
They remove guard output, recovery markers, individual reference reads, routed skill
loads, the anytime step, covered calls, requests or decisions independently. They
also change a command under the same tool, move only the named prerequisite read
after Edit while retaining other early reads, or add the denied offered tool.
The late-read counterexample retains file presence and updates its timestamp and
segment position consistently. Unrelated
text, workspace changes and execution results remain intact. A conforming generated spec must reject every corresponding counterexample;
a missing demand leaves one accepted and makes the bank item fail.

The test plants each missing capability in compiled product output in memory,
leaving the conforming follower unchanged. Every affected bank item turns red;
each mutation is discarded, and a final restored reference run is green.
`completion.ts` contains the bank's counterexamples; they never enter `follow`.
The missing-reference lint input is separately asserted unchanged.

Bank item identifiers, count, levels and thresholds are unchanged. Fixtures
`seed-1.yaml` and `holdout-1.yaml` are regenerated by `fixtureText`, not hand edited.
No product file, floor or executor branch is changed.

## Validation

Run one file at a time, with `--maxWorkers=1 --testTimeout=600000`:

- `packages/validators/test/estate/rulings.test.ts`: reference, deletion mutants,
  restoration, preserved lint defect and estate-derived permission metadata.
- `packages/validators/test/estate/follower.test.ts`: derived follower behavior.
- `packages/validators/test/estate/oracles.test.ts`: production registry and existing
  oracle mutation checks.
- `packages/validators/test/estate/generator.test.ts`: deterministic fixtures and
  generated estate invariants.

Observed results after the review correction: rulings 7/7 and oracles 20/20.
Prior focused results on 7341a1169: follower 6/6 and generator 8/8.
The targeted TypeScript check and Biome check of changed TypeScript files pass.
No ladder sweep or timing claim is made.

## Review correction

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
