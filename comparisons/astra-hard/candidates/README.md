# Registered third-side candidate run

This adds frozen candidates on the exact 192 cases per row in primary
pre-registration 9c1c2ff8783b02d7dffa1b9dcd9b638405f6dce4, seed 20261217.
It is a separate procedure comparison on the same cohort, not an independent
replication. It is never pooled with the primary default comparison.

- promptfoo rubric candidate: unchanged audit renderer and decoder, procedure
  SHA-256 d7f5e226bf5afe7b955ee0f2247835cd19953001c196dcc7260d1f0c37922587.
- Langfuse candidate: unchanged fact-ledger prompt in the original comparison,
  compact JSON query/reference/reply, and original fact-ledger decoder.
- Peers: reuse the primary run's exact recorded answers. No peer rerun or answer
  selection. Main's default remains the first result in the report.
- Calls: 384 additional Haiku requests, once each, with the primary CLI flags.
  Concurrency at most two. The runner requires primary completion first and
  charges primary plus candidate spend against the same USD 10 cap.
- All candidate requests, parsers and this protocol are committed before the
  first candidate call. The methods are frozen from earlier reports and are
  not selected or tuned on the primary predictions.
- Candidate lead bar: candidate accuracy exceeds peer accuracy and the exact
  one-sided paired sign-test p is below 0.05, per row. Otherwise: equal.
- Also report exact two-sided McNemar and a 95 percent percentile bootstrap,
  resampling the 12 whole construction families, 20,000 draws, seed 0x9c1c2ff8.
- Inconclusive answers count as wrong. No labels, cases or prompts change.
- These cases come from the original 12 construction families, not driftbench's
  budget generator. The map-generated cohort remains optional afterward.
