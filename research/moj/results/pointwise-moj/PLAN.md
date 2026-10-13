# Pointwise router rounds

The selection objective is macro balanced accuracy across the three tuning halves,
using grouped five-fold predictions. Validation labels are not consulted for selection.
The reference-guided Verify track remains a separate report-only diagnostic.

| Round | One hypothesis | Refuting number | Parent |
|---|---|---|---|
| r0 | Calibrated confidence routes uncertain rows to Luna | Baseline for subsequent ablations | System-1 rows |
| r1 | Reference-first on supplied references and generated references on reasoning improves judging | No positive change in tuning balanced accuracy | r0 |
| r2 | Cross-family experts help below calibrated confidence 0.7 | No positive change in tuning balanced accuracy | r1 |
| r3 | High-confidence reasoning over supplied evidence still needs System 2 | No positive change in tuning balanced accuracy | r2 |

| r4 | Naming rubric-comparison terrain and cancelling pair order improves rubric judging | No positive change in tuning balanced accuracy | r3 |
| r5 | Equal blending of typed comparison and rubric rows improves judging | No positive change in tuning balanced accuracy | r4 |
| r6 | A tuning-fitted mixture of stage-one, Luna and panel votes improves judging | No positive change in tuning balanced accuracy | r5 |

A hypothesis counts toward stopping only where its changed route actually fires.
A reference-only change has no experimental treatment on a reference-free rubric pair.
The round artifact records this applicability flag. No validation result informs it.
Stop after two consecutive applicable rounds without a tuning gain for a benchmark. Freeze
its best previous content policy; do not choose using validation. The panel uses
Luna, Gemini 3.5 Flash Lite and Haiku, with provider limits 8, 8 and 2.
System 1 always uses the unchanged moj/client.py with its three-call gate.

Hardrows success is a tie with the 100 percent baseline within noise and fewer
System-2 calls. Other primary benchmarks require a lead beyond the recorded noise
floor on matched validation items. Cost is reported per 100 items. System-1 USD
pricing remains unknown. The paid-call budget is 15 USD, reserved before submission.
