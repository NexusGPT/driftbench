# Checklist expert experiment

This experiment writes only checklist results. It never invokes the base collector.

## Reproduce

From `research/moj`:

```sh
python3 -m moj.checklist selftest
python3 -m moj.checklist run --half tune
python3 -m moj.checklist select
python3 -m moj.checklist run --half valid
python3 -m moj.checklist report
python3 -m moj.checklist run --offline
```

The final command reconstructs all eight variants from request-hash recordings,
compares every signal with its stored result, and writes `replay.json`. Offline
mode never loads an API key. A returned answer, including malformed content, is
never regenerated. Only a call without an answer can be retried, with three total
submissions across process restarts. A start event is saved before network use.

## Frozen design

The factorial study varies writer reasoning effort (`low`, `medium`), tick call
layout (`batch`, `single`), and aggregation weights (`equal`, `writer`). The writer is asked for four to eight yes-or-no boxes. Short checklists are used
as returned for the headline result. The separate strict result abstains on them. The writer sees only the question and
benchmark criterion. No candidate, label, baseline verdict, or split is included.
Writer weights are importance numbers from one to five, not fitted from labels.

Batch evaluates every box for both candidates in one System-1 request per order.
Single evaluates one box for one candidate per request, in both orders. Both
layouts use identical question wording and candidate context. The equal/writer
variants reuse exactly the same tick probabilities. Low/medium use separate
checklists because writer effort is the controlled intervention.

For each candidate, code computes `sum(weight * P(yes)) / sum(weight)`.
For each order, its margin is `score(FIRST) - score(SECOND)`.
The original-A signal is `0.5 + (margin_AB - margin_BA) / 4`.
This cancels a constant position effect. The signal is not a calibrated probability.
A missing checklist or tick yields abstention and half credit, never silent exclusion.

Directional hypotheses, declared before examining accuracy:

- Medium writer effort improves accuracy over low effort.
- Individual tick calls improve accuracy over batched ticks.
- Writer importance weights improve accuracy over equal weights.
- The tuning-selected variant improves on recorded promptfoo on matched validation pairs.

A nonpositive validation accuracy difference refutes each directional gain claim.
Choose one variant by equal-benchmark macro accuracy on tuning only. Break ties by
System-2 USD, System-1 calls, then variant name. Save `selection.json` before any
validation collection. All variants are reported on validation without reselection.

## Data and interpretation

Only the three practice adapters in `moj/benches.py` are read. The fixed hash split
is unchanged. JudgeBench has 41 tuning and 27 validation pairs. MM-Eval has 24 and 26 rows, but five exact duplicate IDs collapse to
22 and 23 unique pairs under the harness ID-keyed scoring convention. Writing has 22 and 28. Six writing prompt hashes occur in both halves, so the
writing estimate is not independent at the prompt level. No checklist uses labels.

The intervals follow the harness Wilson 95 percent convention with fractional
tie credit and pairs as units. They are descriptive: repeated prompts and related
variants are not independent, and no multiple-comparison correction is applied.
Recorded baseline games retain the harness order-level scoring. Matched-pair cells
are provided when a baseline covers fewer pairs. No baseline is called again.

System-1 has no published tariff. Report calls and returned-call latency separately.
System-2 USD uses recorded token usage and the price constants in `moj/client.py`.
Those are harness estimates, not independently verified invoices. The budget is
8 USD. `spend.json` includes measured usage and conservative reservations for calls
whose billable outcome is unknown. System-2 has an eight-call semaphore. System-1 was reduced from eight to three
during tuning because other helpers share its gateway. HTTP 403 responses without
an answer wait 20 and 60 seconds before the remaining submissions, then cool down
180 seconds after exhaustion. There is no fourth submission.

Checklist hashes include the question, rubric, writer effort, model settings and
prompt version. They exclude candidate answers. Equal/writer and batch/single
therefore share checklist generation. Identical requests share tick recordings too.
A new candidate for an unchanged item costs no new checklist generation. An exact
repeat costs no new calls of either kind.

## Evidence inputs

The supplied research cards motivate this architecture:
[TICK](https://arxiv.org/abs/2410.03608),
[RocketEval](https://arxiv.org/abs/2503.05142), and
[MultiChallenge](https://arxiv.org/abs/2501.17399).
Their reported results are not treated as measurements of this implementation.

## Short checklists

The owner requested that returned two- or three-box checklists be used as a product
would use them. No generation is repeated. The primary score uses returned boxes;
the sensitivity score abstains whenever fewer than four boxes were returned. The
report counts short checklists per variant and provides both scores on that subset
and over the full half. This choice was made during tuning, before validation.

The score table uses cold-cohort submissions, including retries, per 100 unique
pairs. Duplicate question hashes share System-2 generation. JSON also reports
logical System-1 requests, unique requests, and the incremental validation cost
after reusing the tuning checklist cache.

## Observed outcome

The tuning-selected medium/single/equal variant does not improve on promptfoo on
any matched validation benchmark. Low effort performs better in validation, but
the selected variant is not changed after observing validation labels. Three
low-effort JudgeBench tuning checklists are short; all three decide correctly as
returned, versus half credit under strict abstention. Validation has no short
checklists.

Offline reconstruction uses zero network calls and leaves all recording, cache
and signal hashes unchanged. `audit.json` verifies persistent retry limits and
that no returned answer is submitted again. Three interrupted System-2 starts
retain conservative budget reservations because their billed outcome is unknown.

No 403 recurs after reducing concurrency. Its earlier bodies were not retained, so
the cause remains unconfirmed. The optional private diagnostic capture is armed
through `CHECKLIST_NOTES_PATH`; it omits authorization/cookie headers and redacts
the credential before writing one response body.
