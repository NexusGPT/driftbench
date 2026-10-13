# Planted truth and repeated judgments

The two banks use code-defined truth and DEV source templates only.
The generation seed and every stimulus are committed before judging.

- Verify: 95 clean/defect pairs from 10 DEV templates, yielding 190 point judgments.
- RubricBench: 60 clean/defect pairs from 10 DEV templates, yielding 60 canonical pair judgments.
- Rubric truth concerns one objective, verbatim expert requirement per item. It is not a claim about the entire original rubric.
- Repeated templates limit generalization. Ordinary Wilson intervals describe these bank rates and do not remove family dependence.
- Noise: 30 original DEV items per benchmark, three complete fresh judge runs. The restricted sampling frame excludes business records.

The frozen judges are copied without prompt or inference changes from the assigned source worktrees. A separate transport wrapper meters spending and caps simultaneous model calls at six, under the owner's revised USD 16 task cap. The first phase used a two-call limit and an USD 8 cap. All model calls use haiku. The wrapper reserves USD 0.25 per in-flight call, retains that amount for unpriced failures, and requests a USD 0.10 per-call CLI ceiling. Provider billing remains authoritative.

The verify runner is the frozen source runner with injected DEV-only items. RubricBench uses the frozen canonical sort, code evidence, prompt and binary aggregation. Both original caller orders map to the same canonical request, so one call provides the canonical winner and per-requirement grades.

The bank runs before noise. Each noise repetition has a separate recording namespace, with unchanged prompts. Historical model recordings are never loaded.

Run the generator with `python3 research/planted/build-bank.py`. The experiment entry point is `research/planted/run.ts`. Audited output is copied to `research/planted/results/` for the final evidence commit. Runtime scratch files remain local.

TPR is the share of planted defects rejected. TNR is the share of clean twins accepted. RubricBench acceptance is full satisfaction, score 2, of its single requirement; partial satisfaction counts as defect detection. Pairwise clean-winner recovery is reported separately. Missing or malformed outputs never count as successes.

The noise report includes pairwise disagreement across the three repeats and the share of items with any flip. The plug-in 95 percent floor for the difference between two independent full-DEV accuracy runs is `1.96 * sqrt(correctness_flip_rate / N)`. This extrapolates the restricted cohort to N and is labeled as such. The smallest discrete DEV gain strictly exceeding it is reported in items and percentage points. Item-resampled bootstrap uncertainty keeps the three comparisons from one item together.
