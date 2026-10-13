# LongJudge verification evidence

The final report is the separately authorized `report-verify.md` in the lead's scratchpad. This directory holds reproducible public-source evidence.

- `summary.json`: complete 95-item DEV scores. Official and audited scores remain separate; cost includes every model call needed by each design.
- `label-audit.json` and `examples/judge-benchmarks/src/verify-label-audit.py`: ten current DEV corrections, including one disclosed polar convention. `label-audit-initial.json` and the nine-correction snapshot preserve earlier audit states.
- `remaining-dev-audit-summary.md`: all 95 DEV verdicts, qualifications, and the full missing-final-answer proof. `remaining-dev-audit.md` holds the longer source appendix. `dev-proof-reproduction.json` records the initial five independently executed proof programs. `dev-proof-reproduction-portable.json` records the successful rerun after replacing local paths with repository-relative paths.
- `test-label-audit.md`, `.json`, and `.py`: the independent 221-item read-only TEST audit, with 22 literal-premise corrections and one final-option-policy correction. Unresolved cases keep official labels.
- `test-exposure-provenance.md` and `.json`: earlier official TEST scores, costs, raw outputs and source hashes. Tonight is confirmation on a previously evaluated split. Local absolute paths use placeholders.
- `why-it-works-proofs.json`: independent exact calculations for two DEV improvements.
- `freeze-plan.json` and `freeze.json`: chosen design, frozen source and audit hashes, source population hash, preregistered cohort and commit identity. These files are created at the freeze.
- `frozen-dev.json`, `test-result.json`, and `test-metrics.json`: strict zero-call DEV confirmation and the one frozen TEST evaluation. Test metrics include raw sample accuracy, balanced accuracy, population-weighted accuracy and approximate 95% intervals.

Interrupted runs are excluded from full-score selection. Program outputs and model replies remain in `recordings/longjudge-verify/`. Source labels and the official scorer are unchanged. No audit ids or labels enter judging. Numerical non-findings and unsupported programs are not proofs.
