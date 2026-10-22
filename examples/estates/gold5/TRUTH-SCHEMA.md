# The truth file of a gold estate

Each gold estate (`examples/estates/gold-a`, `gold-b`, `gold-c`) has one `truth.yaml` beside its prose files.
It holds what the gold labels (`gold5.json`) do not: the numbers the prose states, the scope of a condition,
the requests that make a rule apply, and the rules whose deletion must change a test.

The author of a truth file reads the prose files of the estate and `gold5.json` (for unit ids and text). The
author does not read the harness code and does not run a labeller. Every entry names a unit by its gold id
(`id` in `gold5.json`, ten lowercase letters or digits). Nothing is keyed by a word or a pattern of the prose.
Fictional data only: the prose is invented, and so is every ask.

```yaml
version: 1
estate: A                        # A, B or C, as in gold5.json
gold5Sha256: 1c7c7afde32a4e0647b6ad9000007a575f9bb89b3130e53329da7df748149ed6

# 1. Numeric limits. One entry for each unit that states a number a test can cross.
limits:
  - unit: ab12cd34ef             # the unit that states the number
    limit: 5                     # the number, as a finite number
    comparison: le               # lt, le, gt or ge: how the quantity compares with the limit
                                 # for the condition to hold ("within five days" is le)
    role: constraint             # constraint: the comparison is the compliant range of the act;
                                 # trigger: the comparison is the range where the rule applies
    unit_of: working days        # optional: what the number counts
    governs: ab12cd34ef          # the gold id of the rule the limit belongs to (may be the same unit)

# 2. Scope. A condition unit only says when another unit applies and orders nothing by itself.
scopes:
  - unit: cd34ef56ab             # the condition unit
    target: ef56ab78cd           # the rule, prohibition or gate unit it scopes (a later unit of the file)

# 3. Planted rules. 8 to 12 rules per estate. A rule is planted when a request exists that only this
#    rule makes the agent answer in a given way, so deleting its line must change that answer.
#    Use rules, prohibitions and gates that agree in gold5 (label rule, prohibition or gate).
planted_rules:
  - unit: ef56ab78cd             # the gold id of the rule unit
    ask: "My bill shows the same charge twice."   # one request a user would type, 3 to 25 words
    reply_act: report            # answer, clarify, refuse, report, draft or acknowledge:
                                 # what the reply does when the rule applies
    near_miss: "How much does the large plan cost?"   # a request just outside the rule's trigger
                                 # (the rule must not apply to it)

# 4. Plan. What the plan of the estate must and must not hold.
plan:
  cover:                         # units whose atoms must be named by at least one plan row
    - ef56ab78cd
  exclude:                       # units that must not be named by any plan row
    - 12ab34cd56
  same_row:                      # groups of units that apply in the same situation: one plan row
    - [ef56ab78cd, 78cd90ef12]   # must name all of them (use this for 2 to 4 units; 0 to 6 groups) (use this for 2 to 4 units; 0 to 6 groups)
```

## Rules for the author

* Every `unit` and `target` and `governs` must be a gold id of the same estate. A wrong id fails the test
  that loads the file, and the test names the entry.
* `limits`: only units that state a number as a limit, a count, a size or a duration a test could cross.
  A number inside an example or a description that orders nothing is not a limit. State the comparison from
  the sentence, not from a guess about the test.
* `planted_rules`: the unit must carry a gold label of `rule`, `prohibition` or `gate` with `agreed: true`,
  and must sit in a file other than the standing file of the estate (`A-standing-instructions.md`,
  `B-standing-instructions.md`, `C-main-prompt-with-channel-tabs.md`): the harness loads every other file as a
  skill, and a rule is tested through the skill that carries it.
  The `ask` must be a request, not a copy of the rule. `near_miss` is optional but wanted for at least half
  of the entries.
* `plan.cover` and `plan.exclude`: `cover` takes units with an agreed label of `rule`, `prohibition` or
  `gate`. `exclude` takes units with an agreed label of `example`, `description` or `none`. Give 10 to 30
  entries in each.
* `scopes`: the harness labels the condition unit `condition` for the chain, whatever its gold label, and
  points it at the target. Choose pairs where the condition unit and the target are in one section.
* Do not copy text from the prose into the file other than `ask`, `near_miss` and `unit_of`.
* An empty list is allowed only for `scopes`, `plan.same_row` and `limits` when the estate has none.

## Normal form of a limit

Two readings can state one fact. A prohibition forbids an act in a range: "Do not draw a chart for fewer than four
numbers" is the trigger `lt 4` (the rule applies when the quantity is less than four) and also the constraint `ge 4`
(the act is compliant when the quantity is at least four). The compliant range of the act is the complement of the range
where the prohibition applies.

The scorer compares limits in this normal form: when the governing unit is a prohibition (its gold label), a
`trigger` is converted into the `constraint` with the negated comparison (`lt` and `ge`, `le` and `gt`). Nothing else is
converted. For a rule that is not a prohibition, a trigger and a constraint state different facts and stay apart, and so do
readings with another number or another comparison. The truth files may therefore write either form on a prohibition.
The conversion is in `packages/estate/test/gold/normal-form.ts`, with tests that non-equivalent readings still differ.

## History of the limits in the truth files

The truth files were first written from the prose alone by a lane that had not read the harness: 38 limits (A 16, B 8, C 14), without a `role`. They were extended afterwards, from the model's output, to 56 limits (A 25, B 12, C 19), each with a `role`:

* `d2e842d3c`: after the first per-atom recording, the units the producer had returned as extras were judged by the truth lane, which was sent the unit ids without the model's answers (per the lead's brief; the judge's own record is `TRUTH-NOTES.md`). 17 limits were added (A 9, B 3, C 5). All 17 were extras of that recording, so the judged list held only units the model had returned.
* `4ef73174f`: `role: constraint | trigger` added to every limit, 45 constraints and 10 triggers.
* `d6fca1583`: one more limit added after a further blind check (B `lwci7tropa`), which the producer had also returned as an extra.

Because the added limits come from the model's extras, the answer key was enlarged with the model's own output. Figures against the 38-limit truth and the 56-limit truth must both be reported (see `docs/variables.md`). The judgements and the reason for each unit left out are in `TRUTH-NOTES.md`.
