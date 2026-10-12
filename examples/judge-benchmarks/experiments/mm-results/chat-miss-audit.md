# Direct-contract chat pilot: every miss

Audit reads the complete request, both replies and both judge outputs for every
item below. Evidence is `chat-miss-evidence.json`. No model call is made for the
audit. The pilot contains 20 chat pairs; 10 score below 1. There are 14 wrong
games and two tied games, giving 62.5% chat accuracy.

| Item | Score | Primary cause | Evidence from the two orders |
|---|---:|---|---|
| 3244 | 0.50 | Unstable accuracy versus coverage weighting | One order values broad construction-health advice despite its dubious lung-moisture claim; the other values specific protection and penalizes that claim. |
| 3320 | 0.00 | Context and epistemic-ranking disagreement | Both orders prefer the terse claim that the video format spread. The label prefers a hypothetical, hedged consequences discussion. Neither reply proves actual consequences. |
| 3352 | 0.00 | Factuality versus preference-label disagreement | Both orders prefer the historical-consensus reply to the muddled fictional-Jesus/Buddha account. This is a label-audit candidate, not a proven label error. |
| 3450 | 0.00 | Unverified factual defects and relevance weighting | The judge rejects several addiction-film recommendations as unrelated and criticizes a list for listing the number it claims. Several alleged defects need independent verification. |
| 3458 | 0.50 | Unstable weighting plus an unsupported factual defect | One order rewards Word-specific guidance. The other wrongly assumes Microsoft Editor does not exist and rewards a presentation checklist. |
| 3496 | 0.75 | Close-pair tie and unstable nuance weighting | Both replies explain HDD vulnerability. One order balances nuance against the read-head/data-loss explanation and ties; the other picks the fuller explanation. |
| 3500 | 0.00 | Creative-taste disagreement | Both orders prefer the rhymed personalized mechanic/HR/climbing poem. The label prefers the more literal, generic poem. No objective correctness proof decides this preference. |
| 3539 | 0.00 | Factuality versus preference-label disagreement | Both orders reject detailed Kilcher biography claims as fabricated, while acknowledging a doctorate error in the other reply. External verification is absent; label error is not established. |
| 3584 | 0.00 | Over-enforced script preference | Both orders treat Traditional Chinese as violating a Simplified Chinese request and let that dominate substance. The user never explicitly asks for Simplified script. |
| 3591 | 0.75 | Close-pair tie and cosmetic weighting | Both replies share the same chemistry scope issue. One order ties; the other prefers arrows and continuous numbering. |

Counts by primary cause: unstable weighting 2 items, context/epistemic ranking 1,
factuality/label disagreement 2, unverified factual defects 1, close-pair ties 2,
creative taste 1, script over-enforcement 1. These are causes of measured
disagreement, not claims that all ten judgments are objectively wrong.

Microsoft confirms that [Editor runs in Word](https://support.microsoft.com/en-us/word/how-to-check-grammar-in-word).
This independently verifies the invented-defect finding for item 3458. The other
historical and biography disputes remain candidates for review, not proven label errors.

## Chosen architecture

Use blind crowd responses to the request as comparison evidence, then assess
each candidate alone against that evidence. A final judge compares the short
assessments in both orders. Three fixed crowd perspectives cover direct utility,
domain accuracy and the intended reader. They see neither candidate nor labels.
References are fallible comparison material, never an answer key. The per-reply
reader records actual strengths, defects, uncertain claims and supporting quotes.
The final result uses the shared explicit-winner contract from `codex/judge-arch`.

This instantiates preference ideas T15 (crowd comparison) and T12 (independent
reading), with verify Rank 4's warning against injecting an untrusted reference.
It targets inconsistent weighting and invented defects by providing concrete
alternative completions and recording evidence before the candidate comparison.
It cannot prove away human taste or label noise. No length, preference label,
subset ID, or benchmark item ID enters a model prompt.

The next architecture run requests all 1,452 DEV items, including every subset,
not only audited misses. It reports calls per item and inference cost per 100
items at every checkpoint. The unchanged task budget and deadline may stop a run
before full coverage; that coverage is disclosed. TEST is conditional on achieving
the requested DEV target and freezing the configuration.
