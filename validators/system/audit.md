# Audit of system ladder version 6 (docs/validators.md section 12.7)

Three audit helpers ran on 2026-10-18, model-free, on Sonnet. None read the system bank, its fixtures, this folder's handover or its journal. They audited levels 12 and 13, the 319 items version 6 adds. Their reports are in [audit-v6](audit-v6/). The verdict lines below are quoted from those reports. Only the blind pilot line is written by the builder: it puts the helper's measured numbers into the verdict form.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pass | Fresh executor, bank items only: 281 to 319 of 319 in 5 iterations, 7.6 items fixed per iteration, against the builder's 6.3. The builder pilot is not 1.5 times slower. The forecast stays 0. |
| cheater | fail | 7 of 8 cheats gained, and stacked they raise 281 to 317 of 319: spec-id prefixes that hold on every seed, process argv sniffing, the child-first shape with no counter-case, and a help check that reads only the usage line. |
| cause review | pass | 38 of 38 agree. The review finds 5 distinct causes, where the builder tagged 6: the mode P position and the specIndex items share one change. |
| planted bugs | fail | 13 of 20 bugs lost at least one item. Missed: a 0/1 block weight, refuted links charging a section, an anchor quote found twice, value_in_message by substring, a canonical-prefix unpaired call made an error, gate-exit giving 1 for a run that is blocked only, provenance left in the spec hash. |

Owed before this ladder can pass section 12.7: each cheat and each missed bug becomes a new item, in a maintainer commit (section 12.3). Then the audit runs again.
