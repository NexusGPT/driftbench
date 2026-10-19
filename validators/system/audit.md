# Audit of system ladder version 6 (docs/validators.md section 12.7)

Three audit helpers ran on 2026-10-18, model-free, on Sonnet. None read the system bank, its fixtures, this folder's handover or its journal. They audited levels 12 and 13, the 319 items version 6 adds. Their reports are in [audit-v6](audit-v6/). The verdict lines below are quoted from those reports. Only the blind pilot line is written by the builder: it puts the helper's measured numbers into the verdict form.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pass | Fresh executor, bank items only: 281 to 319 of 319 in 5 iterations, 7.6 items fixed per iteration, against the builder's 6.3. The builder pilot is not 1.5 times slower. The forecast stays 0. |
| cheater | fail | Round 4 at `c5e542846` (ids of drawn format, parent-forest orders drawn): 21 of 27 cheats gained, and two stacks take all 413 items to pass on seeds 1, 2, 977 and 4242. The id-format cheats of round 3 gain nothing now. The gates that work: the fixed prompt id `planted-agent`, `process.argv[1]` of `app`, links all at `v1`, a block count of 4 or 5, and the call stack (the CLI items run in-process). Shape-only selection still gains, as the select-parent items accept over-selection. Round 3 at `888eb7a78` had 8 of 13. |
| cause review | pass | 38 of 38 agree. The review finds 5 distinct causes, where the builder tagged 6: the mode P position and the specIndex items share one change. |
| planted bugs | pass | Re-audit at `1e2f321ce`, after the 94 audit items: 20 of 20 bugs lost at least one item (26 of 28 with the extras). The first round at `ec004befd` had 13 of 20. |

Done after the first round: each cheat and missed bug became items (94, `620e70874`); after the re-audit, the remaining cheat routes were closed (`6fb7176cb`). Owed: ids with no fixed format, and counter-cases for every item shape a cheat keys on (a child authored before its parent that must stay out, a perturbed run whose shift must not apply), then a fourth round. A cheat that reads the call stack can only be met by running the items in a child process.

## Round 4 (2026-10-19)

Before it, the builder drew every id of levels 12 and 13 from the seed with no fixed prefix, length or alphabet (spec, block and perturbation ids; section ids in slug form), drew the global section's id, and drew the authored order of the parent-forest items from the seed (each child kept against its parent and each block against the changed root, every other pair free; the roots forest draws every order). Main's product still fails the same 49 items in the same 8 causes; the pilot `exec/system-links-pilot` at `d49dfe705` passes 413 of 413 on seeds 1 to 5, 977 and 4242. A fresh helper then ran round 4: its report is `audit-v6/cheater-4.md`, its two whole stacks are in `audit-v6/cheats-4/`.

Owed, from that report: the prompt id, link versions and block counts drawn from the seed; an over-selection check on the select-parent items where the page states which blocks stay out; a localize forest deeper than one level; the CLI items run in a child process (no in-process check can hide the call stack or argv). Then round 5.
