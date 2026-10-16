# Estate task generation audit

Owner rule, verbatim:

> make sure all the fixes are fixes that are TO THE FRAMEWORK in general and not just fixes that are overfitting to the problem to make the test pass

## Input and method

The baseline is commit `a91598b5e` from `feat/estate-reader-level1`.
The fictional input is `packages/generate/test/estate/scale-situations.ts`.
It contains 24 independently declared editorial skills and 576 gates:
288 distinct action/object/desk situations, each stated twice.
Descriptions deliberately share a broad desk-management purpose.
Prerequisites name policy files; asks must leave those files for the agent to discover.

The audit scans without a model, builds and approves the plan, then generates without a phrase bank.
Neither the input nor product code imports the validator's estate bank or private estate material.
The same input is used before and after. Completeness means a structurally runnable specification,
not demonstrated agent compliance. Many operation orders need a configured judge at execution time.
No model or paid API runs in this measurement.

Reproduce the measurement from the repository root:

```sh
node --import tsx packages/generate/test/estate/scale-audit.ts /absolute/output.json
```

The audit entry point works on both versions. When reproducing the baseline, copy only the audit
entry point and its fictional input into that checkout; keep product code at the baseline commit.

## Structural completeness and ask diversity

| Measurement | Before | After |
|---|---:|---:|
| Source plan rows | 9,866 | 9,866 |
| Emitted specifications, static included | 9,866 | 9,002 |
| Complete specifications | 1,802 | 9,002 |
| Incomplete specifications | 8,064 | 0 |
| Complete share | 18.26% | 100% |
| Complete specifications with an ask | 1,800 | 9,000 |
| Distinct first asks in complete specifications | 584 | 584 |
| Distinct asks per 100 complete asked tests | 32.44 | 6.49 |
| Primary gate tests | 576 | 288 |
| Distinct primary gate asks | 288 | 288 |
| Distinct asks per 100 primary gate tests | 50 | 100 |
| Exact duplicate tests represented by other tests | 0 | 864 |

The full-suite diversity rate decreases because previously incomplete event variations now have
a real task. Those variations deliberately repeat their source action across different session and
deviation cells. The distinct-ask count does not increase through cosmetic synonyms.
The primary gate comparison isolates the same rule population and removes duplicated statements.

A complete representative retains the source tests it replaces. The source-row count does not shrink.
Tests with different actions, prerequisites, workspaces, expectations, event cells or replay alignments
remain distinct. Generated criterion names are incidental; their full rubrics and flags must agree.

## Author's hand-judged sample

This is an author review, not an independent or blinded judgment.
The sample takes every thirty-first primary gate test from the baseline, up to twelve.
Each is matched after grouping through its source atom membership.

Rubric:

- Good: the principal request names the governed action and its object; it reveals no prerequisite or expected skill.
- Partial: the principal request is generic and only a secondary situation supplies the governed action.
- Meaningless: no governed task, a wrong task, or the ask states the expected prerequisite instead of requesting work.

Every baseline ask below begins “Please manage the editorial desk and its publication queue.”
Its second sentence is “This involves …” followed by the action in the table.
Every changed ask begins “Please …” followed directly by that action in imperative form.

| Governed action and object | Before | After |
|---|---|---|
| Edit the interview for desk 0 | Partial | Good |
| Translate the interview for desk 1 | Partial | Good |
| Publish the photo caption for desk 10 | Partial | Good |
| Archive the photo caption for desk 11 | Partial | Good |
| Review the interview for desk 13 | Partial | Good |
| Export the interview for desk 14 | Partial | Good |
| Translate the photo caption for desk 15 | Partial | Good |
| Edit the interview for desk 17 | Partial | Good |
| Archive the interview for desk 18 | Partial | Good |
| Publish the photo caption for desk 19 | Partial | Good |
| Export the photo caption for desk 2 | Partial | Good |
| Review the interview for desk 21 | Partial | Good |

Result: good 0 → 12; partial 12 → 0; meaningless 0 → 0.
This synthetic input reproduces generic principal requests and lost target-only context.
It does not claim to reproduce the private estate's reported meaningfulness distribution.

## Regression checks

Product tests cover independent editorial actions, standing and nested-reference ownership,
documented guard rule text and source spans, conservative refusals, multiple simultaneous missing
pieces, exact-equivalence membership, semantic counterexamples and focused mutation opportunities.
The statistics integration test generates one representative for four source cells and counts four;
striking one source row leaves three covered cells. An advisory `blocking: false` note preserves coverage.

Current plan and suite byte snapshots hash the complete rendered outputs.
The older example output tree stays as its historical capture.

Validator comparison: pending the paired all-level, all-required-seed measurements.
