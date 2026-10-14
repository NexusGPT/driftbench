# Research: validator generator

Append only, one entry per research pass (docs/validators.md section 10.6): the question, the sources read (URL or path), what others do, what to try, and why.

## 2026-10-13, executor on `exec/generator-v3` (journal rows 18 and 19)

Question. The ladder stood at level 5 with the open items of the previous handover marked as blocked by the spec language or the follower. Which of them can the generator still fix from the approved map alone, and how does the validator count what a spec covers?

Sources read (local only; no web source was needed):
- `packages/space/src/place.ts`: a spec's placements are its blocks and its declared perturbations; a perturbation is placed on the stage the conversation had reached at `inject_at`, or on its own expected stage when nothing was reached yet.
- `packages/users/src/perturb.ts`: a perturbation with user text is injected before block `inject_at` and the walk goes on after it; a world change stays "from this point", so the block after it must restore the tool.
- `packages/generate/src/gate/gate.ts` (`siblingIndex`, `contrastStage`, `twinIndex`): one-slot siblings are compared on the block cell the generator records; twins of one metamorphic family are exempt and must agree.
- `packages/validators/src/ladders/generator/render.ts` (`replyRules`) and the seed 1 fixture: every flow transition has an approved `states` relation whose patterns read the bound value of each returned field.
- `packages/validators/src/ladders/generator/follower.ts`, `faults.ts`, `possible.ts`, `bank*.ts`: what the rule follower does on a data request, a deviation, a tool failure and a teacher-forced block, and how each item is computed.

What others do. Nothing was taken from outside the repository. The closest outside method considered and rejected is test suite minimisation (dropping a block whose Then and outcomes repeat another's) for the `minimal.*` items: the gate's `observed` stage rejects a block with no machine Then, so it cannot be applied here.

What was tried, and why.
- Read the returned value in the Then through the map's own `states` relation by walking the move that calls the tool, in place of a bare "the tool ran" turn: the map already states it, and the first-tool shortcut then fails.
- Record a probe where it is said, since the validator's `possible.ts` and `place.ts` both read a deviation at the stage the conversation had reached.
- Cover a cell on the start stage with a declared perturbation, since `place.ts` counts it and no block there can fail an idle reply.
- Put the persona phrases in one metamorphic family, since only twins are exempt from the contrast stage.
- Balance free context draws on a shared count, since the constraints of some maps keep most behaviours on one channel.

Finding. The remaining failing items are not reachable from the generator: each needs a rule the map does not state, a relation the map does not have, or a change of the rule follower. They are listed, with their evidence, in HANDOVER.md as items to rule on.


## V4 reference-equivalent contrast

- Question: must a one-slot edit always change the correct answer?
- Sources: `packages/generate/src/gate/gate.ts#contrastStage`; `packages/validators/src/ladders/generator/bank4.ts`; maintainer ruling that `gate.contrast.then-ignores-edit` is valid as written.
- Finding: the blanket product check rejects two valid refusals. Stable passing reference behavior can establish equivalence; matching pass/fail alone cannot.
- Change: compare structured observed behavior, preserving wording-only contrast and conservative handling of out-of-band state.
- Result: seed 1 reaches level 8; gate items pass 22/22 on seeds 1, 2 and 3. No full-bank score is inferred.
- New hypotheses pending empirical checks: canonical Given for repeated setup, explicit current-When binding after a prior lookup, opening-stage read requests, exactly two read-only failure attempts.
