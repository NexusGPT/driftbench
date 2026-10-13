# Four consensus false passes, read before the new source

All four are validation diagnostics requested by the owner. Labels stay unchanged.
The blind judge sees neither these diagnoses nor the labels or upstream references.

| ID prefix | Candidate final | Error classification | Evidence |
|---|---|---|---|
| 848aefe | BC | Unsupported proof step: a partial order is promoted to a complete order | The candidate asserts "Opinion comes first if present" and "Purpose comes last if present". The examples imply opinion before purpose, but do not place either relative to the six-category chain. Code finds 28 consistent total orders. This is an inference gap, not arithmetic or failing code. |
| 987731f | 9 | No final-answer error demonstrated; recorded fail label conflicts with exact calculation | Enumerating all 15 equally likely unordered pairs gives total 135 and expectation 9. Linearity also gives 2 times 4.5. The candidate's final number and method agree. |
| aee1de2 | E | No skipped constraint found; recorded fail label conflicts with an explicit valid witness | Exhaustive enumeration checks all 40,320 assignments, finds 48 legal assignments, and 12 witnesses for E. A-D each have zero witnesses. The candidate's supplied witness is legal. |
| d29e283 | Not specified | Interpretation conflict and an unsupported alternative, not a demonstrated wrong final answer | Greg is a rhino; only Brian's color is stated. No rule transfers color between rhinos. The candidate entertains yellow, but ends "The context does not specify Greg's color." |

`computed_checks.py` reproduces the arithmetic and constraint checks from the
question text alone. Its explicit hand transcription is a diagnostic artifact,
not a learned per-item exception. The adjective check establishes missing order
information; it does not pretend that one unprovided total order is ground truth.
No code-answer case occurs in these four examples.

The selected new model source is error hunting: an independent Luna pass must quote
and justify a surviving final-answer defect. This specifically tests the inference
and constraint failures. Computed checks are also reported, but cannot turn a
mathematically supported answer into a fail merely to improve label agreement.
