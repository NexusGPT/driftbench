# Candidate with decoded quotes

`../audit-normalized.ts` corrects only copied JSON quote escapes. It first checks the original evidence. If that quote is absent, it decodes a copied backslash-quote and accepts the result only when that exact text occurs in the submission. It then uses the original strict ledger scorer. Changed words, fabricated evidence, invalid ledgers and unknown conditions remain unscored.

The original frozen prompt in `../audit.ts` is unchanged. This scorer is **not yet the shipped default**. The free hard-panel diagnostic improves 104/120 to 117/120, while exposing one false failure from an invented requirement and retaining two unknown judgments about unseen actions. It does not change the original published recordings or results.

`freeze.json` fixes two fresh 60-case sets before calls, each with 30 passes and 30 failures. The unchanged generator uses new seeds. Requests are unique and do not match any prior requested set, including unfinished runs. The shipped judge, corrected candidate and Inspect default each run once on the same fresh cases, with three Haiku votes per item and at most two calls in flight.

Run or replay from the repository root:

```sh
CAP_USD=0 node --import tsx comparisons/inspect/hard/run.mts panel audit --normalized --replay
CAP_USD=0 node --import tsx comparisons/inspect/hard/run.mts panel audit --normalized --heldout --replay
```

Repeat for borderline and ours/theirs. Complete prompts and replies remain in `../calls.jsonl`; summaries have their own files here. The later candidate with explicit scope rules has separate prompts, frozen inputs and results in `../scoped/`.
