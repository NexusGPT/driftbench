# Reference-first matched ablation

The canonical report is `hardrows-v2-validation.json`. Replay it with:

```sh
python3 -m moj.reference_run --offline --bench hardrows
```

The expert accepts only explicit `reference`, `reference_answer`, or
`reference_rows` fields. It never constructs a reference from a winning candidate
or label. The router checks this expert before other judges. Missing reference
means zero calls and abstention in both ablation arms.

The same Jev model, candidate, criterion, and pointwise call shape are used in
both arms. The reference arm asks whether the candidate agrees with the supplied
reference on the criterion. The blind arm asks whether it meets that criterion
without any reference in the request. One Jev call is used per point item;
pairwise inputs compare each candidate separately. A probability above 0.5 means
pass, below 0.5 fail, and 0.5 receives the harness's tie credit. No threshold was
selected on validation labels.

The adapted hardrows practice data has 48 explicit references. The adapter's
`split_group` keeps shared references in the same half. The final split contains
18 tuning and 30 validation items. Five validation items have recorded baseline
disagreement. Intervals bootstrap reference groups instead of treating related
rows as independent. All-equal binary cells use Wilson intervals over groups.

An earlier run used the adapter's previous item-id split and produced the
historical `hardrows-population.json` and `hardrows-validation.json`. Those files
are retained as audit history and are superseded by the split-v2 report. Updating
the split reused all 96 recorded calls and made no new model request.

Vanilla verify has no reference field. The separate `verify-with-reference`
adapter now carries upstream reference solutions for the same DEV answers.
`verify-with-reference-v2-validation.json` evaluates all 55 validation items with
both arms. The fixed threshold requires no tuning calls; the 40 tuning items
remain unused. Its low-confidence mask uses recorded `pw_whole` probabilities
where present. The 19 available vanilla baselines are matched by exact question,
candidate and label, and shown on their own matched cohort.

```sh
python3 -m moj.reference_run --offline --bench verify-with-reference
```

The hardrows routing mask remains frozen from the experiment's initial snapshot,
when recorded baseline disagreement was available and pointwise stage-1 signals
were not. Later split changes reuse the same 96 hardrows recordings. Verify adds
110 recorded calls. No reference is generated from labels. RubricBench carries
rubric questions, not a reference answer, so it is outside this ablation.

The gateway returns probabilities but no monetary usage. Jev USD per 100 is
therefore unknown, not zero. Shared budget accounting lives in
`../panel/spend.jsonl`, with unknown requests retained as reservations. The
baseline costs here are the recorded dataset costs; the judge families differ
from Jev, while the matched reference ablation keeps the judge fixed.

[No Free Labels](https://arxiv.org/abs/2503.05061) motivates the hypothesis that a
correct supplied reference improves a cheap judge. This experiment uses the
dataset references as supplied and does not establish their correctness beyond
the source benchmark. Its small, synthetic hardrows sample does not establish
transfer to other benchmarks.
