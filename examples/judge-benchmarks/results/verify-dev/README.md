# LongJudge verification evidence

The final report is the separately authorized `report-verify.md` in the lead's scratchpad. This directory holds reproducible public-source evidence.

- `summary.json`: complete 95-item DEV scores. Official and audited scores remain separate; cost includes every model call needed by each design.
- `label-audit.json` and `examples/judge-benchmarks/src/verify-label-audit.py`: ten current DEV corrections, including one disclosed polar convention. `label-audit-initial.json` and the nine-correction snapshot preserve earlier audit states.
- `remaining-dev-audit-summary.md`: all 95 DEV verdicts, qualifications, and the full missing-final-answer proof. `remaining-dev-audit.md` holds the longer source appendix. `dev-proof-reproduction.json` records the initial five independently executed proof programs. `dev-proof-reproduction-portable.json` records the successful rerun after replacing local paths with repository-relative paths.
- `test-label-audit.md`, `.json`, and `.py`: the independent 221-item read-only TEST audit, with 22 literal-premise corrections and one final-option-policy correction. Unresolved cases keep official labels.
- `test-exposure-provenance.md` and `.json`: earlier official TEST scores, costs, raw outputs and source hashes. Tonight is confirmation on a previously evaluated split. Local absolute paths use placeholders.
- `why-it-works-proofs.json`: independent exact calculations for two DEV improvements.
- `freeze-plan.json` and `freeze.json`: chosen design, frozen source and audit hashes, source population hash, preregistered 20-item throughput pilot, adaptive sampling rule and commit identity. The accepted late freeze is 04:37:11 CEST, commit `558d75de017ecbf243852f5669a1bffeb8d511b9`.
- `frozen-dev.json`, `test-result.json`, and `test-metrics.json`: strict zero-call DEV confirmation and the one frozen TEST evaluation. Test metrics include raw sample accuracy, balanced accuracy, population-weighted accuracy and approximate 95% intervals.

Interrupted runs are excluded from full-score selection. Program outputs and model replies remain in `recordings/longjudge-verify/`. Source labels and the official scorer are unchanged. No audit ids or labels enter judging. Numerical non-findings and unsupported programs are not proofs.

- `test-selection.json`: final cohort chosen only from measured first-20 throughput and cost. The pilot belongs to the final cohort and is not judged again.
- `final-paired-dev-changes.json` and `winner-vs-context-changes.json`: current audit-state paired DEV fixes and regressions.
- `frozen-tests.log` and `frozen-typecheck.log`: final frozen-source validation, 56 tests and repository typecheck. Earlier error logs remain historical evidence.

- `test-72-report.md`: complete original 72-item result beside Inspect, official/audited scores, cost and intervals.
- `test-expansion-started.json` and `test-expansion-selection-*.json`: later explicit $16 budget and concurrency-six authorization, plus time/cost-only nested cohort selections. Frozen judge source and audit hashes remain unchanged.
