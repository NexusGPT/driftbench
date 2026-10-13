# Unconditional terminal ablation

This intermediate result is retained, not selected as the final configuration.
The supplied-reference-only arm is under `reference-only/`; the second arm also makes generated-reference comparisons terminal.
The latter scores RubricBench 91.3, hard rows 92.6, Verify 81.6 and reference-guided Verify 96.4 on validation.
The hard-row regression led to the owner's explicit request for one confidence threshold fitted on tuning.
The final frozen result, including that correction and all ablations, is in `../v3/README.md`.
