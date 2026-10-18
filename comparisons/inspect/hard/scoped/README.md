# Candidate with explicit scope rules

This separate comparison procedure follows the hard-set replay diagnosis. It retains the original frozen candidate and quote-decoding results. Its prompt and scorer are `../audit-scoped.ts` and `../audit-normalized.ts`. It is **not yet the shipped default**.

The procedure distinguishes required reply content from descriptions of a successful state. It judges only the complete fictional trace supplied by the generator. Absence of a prohibited tool call within that complete trace does not require proof about unseen external activity. Missing required actions still fail. Claims, quotation attribution, corrections and chronological requirements remain part of the criterion.

The model writes evidence and reasoning before each condition's status. Code computes the verdict. Evidence remains grounded in the exact submission, with the same narrow JSON quote decoding. Changed words and invented evidence remain unscored. The shorter prompt removes only exact duplicate question and reference strings already present in the criterion. All original task, reference and submission information remains available.

`freeze.json` fixes the procedure and 60 new labels per row before model calls. New seeds use the same generator, with 30 passing and 30 failing cases. Every procedure has 60 distinct fresh prompts. Seed selection excludes matches to every prior requested set, including unfinished runs, without using model outcomes. QA and fact share factual cases and identical candidate/baseline requests; their shared calls are billed once. The competitor's two different templates receive separate calls.

The complete-trace assumption is true by construction here. A production integration must supply a caller guarantee of completeness before using this rule for absent actions. These measurements do not establish correctness on incomplete real traces.

Run hard and fresh held-out scoring, from the repository root:

```sh
node --import tsx comparisons/inspect/hard/run.mts panel audit --scoped
node --import tsx comparisons/inspect/hard/run.mts panel audit --scoped --heldout
```

Repeat for the four rows and ours/theirs/audit. Free replay adds `CAP_USD=0` and `--replay`. New paid calls require an explicit cap and an appropriate later deadline. The runner verifies frozen source and input hashes before each fresh held-out run.
