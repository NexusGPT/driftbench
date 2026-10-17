# Pointer bank audit status

This handoff preserves the independent cheater failure. No helper has certified
a passing section 12.7 check. The failure and pending markers keep the merge gate
closed; only independent auditors can replace them with passing findings.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pending | No real-reader adapter or executor pilot is included. An independent executor must run iteration 0 and ten pilot iterations. |
| cheater | fail | Independent review at a7672c443, [comment 6243006972](https://github.com/achammah/driftbench/pull/759#issuecomment-6243006972), found first-unit, text-hash, response-copy and split-text leak score gains. The builder adds regression tests; an independent rerun remains required. |
| cause review | pending | Shared cause names are retained. No independent sample of 30 failing items or agreement measurement exists yet. |
| planted bugs | pending | Harness corruption checks do not establish detection of 20 independently planted reader bugs. |

## Authorship and evidence scope

The author and family helpers never read the reader implementation, its tests,
or PR 692's code diff. The sole reader contract is the design document on
`feat/estate-pointer-reader-design`, commit
`517e63aaeea25e668dac4f9b28abc8019d906c06`. The validator format and merge gates
come from `docs/validators.md` on main at
`346a8249d460fb0a73c1deb6cdfdc6fd10e0e6ec`.

The bank contains 340 items: cutting, ids, re-anchoring, grouping, labels, replay,
privacy, links, radius, scale, and adversarial each have 30, except labels, which has 40. All five difficulty
tiers are represented. Every item contains a seeded plant, exact observable
truth, cause, design citation, and contrasting probes.

The scripted positive adapter is a harness stub, not a reader implementation.
Its green result must never be used as iteration 0, a reader score, a floor,
a pilot, or hardness evidence. The factory is not globally registered until a
separate implementation owner supplies and verifies the real adapter.

## Required independent follow-up

1. Wire the bank-owned adapter to the reader without importing oracle code or
   implementing missing reader behavior in the adapter. Keep missing Layer C
   capabilities failing. Review the design ambiguities in `CONTRACT.md`.
2. Measure the actual reader on seeds 1–20 and its commit-derived hidden seed;
   record real baseline and pilot rows. Do not fabricate a journal or floor
   from stub results. Apply section 12.4's score, forecast and distinct-cause gate.
3. Run the four independent section 12.7 audits with fresh auditors. Their own
   verdicts, reviewed causes and blind pilot rows replace the current failure and pending scaffold.

Known bounded coverage: deterministic unit cuts, fingerprint relations, id
persistence, move/change/delete/ambiguity/split/merge transitions, label stack
bounds, dense-answer validation, request-key perturbations, private serialized
surfaces, link classification and radius/coverage. No live model correctness,
private estate, or unspecified scoring/tie/overflow behavior is claimed.

## Review correction

The independent review was reproduced on `a7672c4433d92f44fc6b1d7d20493f844f2d7be4`
with visible seeds 1–20 and hidden seed 809556612. Stable passes across those seeds
were 8 for first-unit selection, 13 for raw-text hashing, 45 for response copying,
and 42 for split-text leaking (including 27 privacy items). Per-seed leak totals
were 43 or 44. These measurements describe the rejected bank.

The revision keeps all 340 items and their family/tier/cause assignments. It
strengthens their witnesses and retains all four review attacks alongside the
original three cheats. Label decisions contrast policy outcomes; identity checks
retain quotes/status and compare duplicate identities over history. Privacy
answers live in a separate transport fixture, effects are captured by the harness,
and a single private marker character is sufficient to reject a result.

The builder's regression suite requires zero passes for each of seven cheats on
every seed, not merely zero items passing their intersection. Effectful leak
mutants also preserve the honest trace except for an emitted fragment. These
checks close the reported regressions; they do not certify the independent
cheater audit, the reader, or the hardness forecast. The last independent verdict
therefore remains **fail** until its author or another independent auditor reruns it.
