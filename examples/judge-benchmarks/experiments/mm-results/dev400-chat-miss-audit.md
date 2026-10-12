# Fixed DEV400 direct chat audit

All 37 chat pairs are judged. The complete request, both candidates and every
raw comparison attempt are read for each of the 15 pairs scoring below one.
Evidence is `dev400-chat-miss-evidence.json`. Labels remain unchanged.

| Item | Cause class | Evidence |
|---|---|---|
| 3181 | Reliability and task-coverage weighting | Both orders reward concrete Android-only instructions despite absent iPhone guidance; the label prefers the broader clarification response. Device-specific correctness is unverified. |
| 3187 | Unstable language polish versus useful coverage | One order prioritizes Catalan spelling; the other prioritizes budgeting and saving steps. Language-variety allegations are not independently verified. |
| 3221 | Creative usefulness and speculative factual critique | Both orders choose one coherent toast challenge over three alternatives, partly through an unverified physics objection. This does not prove a label error. |
| 3252 | Context-role interpretation and specificity penalty | Both orders reject a contextual author-role description and an unverified model-architecture claim. The label prefers that more contextual identity answer. |
| 3259 | Numerical precision versus explicit coverage | Both orders prioritize the German percentage answer over the internally consistent per-tonne calculation. External emissions figures are unverified. |
| 3279 | Calibration versus specificity | Both orders favor a calibrated niche-adoption answer over the more specific industry examples. No external adoption evidence establishes which preference is correct. |
| 3310 | Unstable constraint adherence versus breadth | One order penalizes returning to the excluded countryside option; the other rewards photography techniques and resources despite that constraint. |
| 3348 | Close-pair weighting instability | One order rewards the trade example; the other rewards transition costs and connection to prior context. The decisive emphasis changes by order. |
| 3389 | Factual calibration displaced by polish | Both orders acknowledge the contested speed claim but favor uniform units and language. Descending order was not explicitly required. Historical speed facts are unverified here. |
| 3485 | Creative acknowledgement versus focus | One order favors one focused tongue twister; the other favors acknowledgement and two alternatives. |
| 3501 | Inconsistent factual objection | One order calls the New York orchestra example misleading; the other says nothing is clearly wrong in that same reply. Its world truth is not independently checked here. |
| 3522 | Technical correctness versus component coverage | Both orders favor four deeper component explanations over six components, using technical objections not independently checked here. |
| 3531 | Explicit brevity traded against coverage | Both orders acknowledge the request for a brief answer, then favor more coverage and political framing. |
| 3576 | Script over-enforcement and detail weighting | Both orders use a Simplified/Traditional distinction without an explicit script requirement, while preferring a thin direct definition over more detail. |
| 3591 | Contract repair changes a close-pair preference | The initial swapped call chooses the labelled winner but omits its Markdown opening. The bounded quote repair flips to the other candidate, trading redundancy against formatting. |

Ten pairs end wrong in both orders and five split by order. One of the ten,
3591, ends wrong in both after a contract repair. These are measured disagreement
causes, not independent proof that every human preference label is wrong.

The selective crowd stage is already predeclared. This audit introduces no
prompt-only change and no new label-based routing rule.
