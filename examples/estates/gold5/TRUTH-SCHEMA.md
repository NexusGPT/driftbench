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

## History of the limits in the truth files

Four states, in order. Counts are limits per estate (A, B, C), read from the files at each commit.

1. `a0be37546`: the first truth files, written from the prose by a lane that had not read the harness or run a producer. 55 limits (A 20, B 13, C 22), without a `role`.
2. `c0359aee7`: before any recording of the producer, the entries whose governing unit carries no agreed rule, prohibition or gate were removed (the schema already required `governs` to name one), and two entries were pointed at their rule. 38 limits (A 16, B 8, C 14). The reason for each removed unit is in `TRUTH-NOTES.md`, section "Revision: limit entries with no governing rule"; most are decided by the label of the governing unit, a few by the lane's reading of the rule. This is the 38-limit truth, the one that was not built from the producer's output.
3. `d2e842d3c`, `4ef73174f`, `d6fca1583`: extended from the model's output, to 56 limits (A 25, B 12, C 19), each with a `role` (45 constraints, 10 triggers). 18 limits were added, all units the producer had returned as extras: 17 after the first per-atom recording (run 39744125508), and B `lwci7tropa` after a later one (run 39750113618). The truth lane judged them from a list of unit ids without the model's answers; the list held only units the model had returned.

4. This change: a blind re-check of the 18 added limits removed one, A `5fnrtqa4dt`. 55 limits (A 24, B 12, C 19), 45 constraints and 10 triggers. B `lwci7tropa` was rejected by a first judge that read partial dumps and accepted by a second judge that read complete dumps, so it stays.

The blind re-check judged a mixed sample of 36 units without the model's answers or the truth values: the 18 added limits, 9 positive controls taken from the original truth and 9 decoys. The first judge (partial dumps) confirmed 9 of 9 controls, 0 of 7 judged decoys (2 were missing from its dumps) and 16 of 18 added limits. The second judge (complete dumps from `gold5.json`) confirmed 9 of 9 controls, 0 of 9 decoys and 17 of 18 added limits. `5fnrtqa4dt` is removed.

An answer key enlarged from the model's output favours the model. Every figure must therefore be reported against both the 38-limit and the 55-limit truth, the 38-limit figure first (see `docs/variables.md`).
