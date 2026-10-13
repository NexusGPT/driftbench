# Optional map replication: construction freeze

This replication is separate from the original 12-family cohort and is never pooled with it.
Maps contain original construction families and truth as categorical axes, plus numeric settings for reply length, number size and distractor count.
The actual driftbench CLI runs generate --budget 192 --t 2. The hidden seed is derived from SHA-256 of this construction-freeze commit, taking its first 8 hexadecimal digits as an integer. No seed is selected from observed outcomes.
Only the 192 budget rows are rendered into judge fixtures. Extra graph rows are coverage scaffolding and are excluded before the gate.
Numeric settings feed the original family constructors. Reply length is a target minimum with neutral padding. Number size selects the rubric price or the closest original reference price step. Distractors are explicitly excluded archive entries.
Before sealing: check label metadata is absent from judge stimuli, drop native character n-gram TF-IDF cosine similarities of at least 0.95 against already kept cases and primary cases, and trim excess labels in seeded order to retain exact balance. All drops are recorded. Constant-pass accuracy must be 0.5.
A blind reader receives only 72 selected items and the label rubric, without planted labels, judge prompts, outputs or scores. Three items per family per row are audited. Any disagreement is disclosed and resolved before sealing, never after scores.
At least 150 and at most 200 cases per row must survive. Otherwise the replication is not run under this registration.
Both main default and frozen candidate use the same peer configuration as the earlier runs. Exactly one answer per side per case. The seal and all rendered prompts and parsers are committed before the first call. Per-side query budget: one.
Saturation is marked after the recorded run when every contestant is correct, or every contestant is wrong. It never filters cases or denominators.
Report exact one-sided candidate versus peer tests, exact two-sided McNemar, and 20,000-draw whole-family percentile bootstrap intervals. Candidate lead requires one-sided p below 0.05 and higher accuracy. Main's lead requires two-sided McNemar below 0.05 and higher accuracy. Otherwise each row is equal.
Run only after the primary and candidate runs finish, before 07:30 Europe/Brussels, and within their shared USD 10 cap. All data is fictional and labels are planted by code.
