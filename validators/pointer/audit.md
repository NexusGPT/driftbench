# Pointer bank audit status

This is the builder's handoff scaffold, not an independent audit verdict.
No helper has certified a section 12.7 check. The pending markers keep the merge
gate closed; independent auditors must replace them with their own findings.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pending | No real-reader adapter or executor pilot is included. An independent executor must run iteration 0 and ten pilot iterations. |
| cheater | pending | The builder supplies empty, per-item constant, and input-echo regression tests. These do not replace an independent cheater search. |
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
   verdicts, reviewed causes and blind pilot rows replace this pending scaffold.

Known bounded coverage: deterministic unit cuts, fingerprint relations, id
persistence, move/change/delete/ambiguity/split/merge transitions, label stack
bounds, dense-answer validation, request-key perturbations, private serialized
surfaces, link classification and radius/coverage. No live model correctness,
private estate, or unspecified scoring/tie/overflow behavior is claimed.
