# MM-Eval DEV experiments

These experiments preserve the harness's existing DEV split. They never run TEST.
The competitors keep their original templates. Every new judge sees only the
criterion, request, candidate replies and its own generated reference or code
observations. Subset names and language metadata never enter a model prompt. The explicitly
authorized cascade uses the chat and safety subsets only for routing. Preference
labels stay in scoring code.

## Samples and scores

`mm-dev.ts` draws the original 1,500-item source sample before applying the DEV
split, then restricts it to shared baseline recording coverage. This yields 463
pairs. The pilot has 20 pairs from each of the five subsets, stratified by language
within each subset. Its 100 pairs and the remaining 363 confirmation pairs are
disjoint. A full DEV run has 1,452 pairs.

MM-Eval's total is the unweighted mean of the five subset means. Each item is
judged in both orders. Correct, incorrect and tied decisions score 1, 0 and 0.5.
Reports include missing answers; an incomplete run is not a complete DEV score.
Inference cost includes recorded calls, so replay does not make the method appear
free. New spend is reported separately and appended to the shared spend ledger.

The historical `mm-sweep.ts` runs one producer at a time. It is retired for this
workstream after the shared winner contract lands. New paid stages use
`mm-cascade.ts`, importing the contract directly from `@driftbench/judges`.
The runner's call semaphore also bounds
pair orders, samples and repairs, which the item concurrency setting alone did
not do. The sweep reserves budget headroom and stops starting calls at its
deadline. A model call already in flight can finish after that deadline.

## Variants

- `direct`, `language` and `rubric` request an explicit A/B winner. Code computes
  pass/fail from that winner. The `contract` variants replay the identical prompts
  and recover only a final declared winner when a reasoning string breaks JSON.
- `language-code` adds franc-all language ID, Unicode script counts, differing
  words, sentence language changes and potential foreign function-word counts.
  These are fallible evidence. They never force a winner.
- `language-safety-code` adds an explicit refusal-correctness rubric. Appropriate
  refusal beats harmful compliance; needless refusal on a benign request loses.
- `integrity-code` requests evidence first, then the opening of the winning
  reply, then its winner ID. Code checks the quoted prefix against that ID and
  permits one repair. An unresolved mismatch is a tie. Identical openings can
  match both replies, so this check does not prove semantic consistency.
- The adaptive variants retain question-only routing, an independent reference
  and three votes per order. `majref` uses three references; `vote5` uses five
  judgements. Their additional inference cost is reported.

franc-all 7.2.0 is MIT licensed, confirmed from its installed package metadata and
the [upstream license](https://github.com/wooorm/franc/blob/main/license).
Short strings, related languages and language instructions can confuse its
trigram detector. Code, URLs and email addresses are removed from prose analysis;
the judge still inspects the original text and requested translations.

## Reproduction

Install from the workspace root with `pnpm install --frozen-lockfile`.
Use `node --import tsx` for these drivers:

```sh
node --import tsx examples/judge-benchmarks/experiments/mm-dev.ts \
  --phase pilot --tag my-pilot-replay --contestants driftbench-mm-language-code \
  --replay-only --cap-usd 0 --ledger /path/to/spend-ledger.md \
  --deadline 2026-10-13T06:55:00+02:00
```

The shared architecture requests the full DEV split:

```sh
node --import tsx examples/judge-benchmarks/experiments/mm-cascade.ts \
  --tag cascade-full-dev --cap-usd 7.7 --concurrency 3 --first-count 400 \
  --contract-sha <integrated-commit> --ledger /path/to/spend-ledger.md \
  --deadline 2026-10-13T06:30:00+02:00
```

The first stage judges each pair directly in both orders using the shared explicit
winner API. Safety pairs receive an additional question-only premise extraction,
followed by both-order comparisons with those exact premises as requirements.
A paired ablation retains the direct safety score and cost separately.
Only chat items, order disagreements or parse failures escalate to three blind
crowd replies, two independent readings and two final shared comparisons.
Code discards evidence quotes absent from the original source. A quotation checks
winner identity; it never selects the winner. Raw winner fields remain recorded.

The fixed seed `mm-cascade-proportional-400-v1` selects 400 DEV items proportionally
across subsets. That complete cascade is reported before the remaining DEV items.
At most three item workers each issue one model call at a time, including bounded
shared-contract repairs. No new call begins after the passed deadline.
Normal production calls are two per direct item, three per premise-aware safety
item, plus seven per escalation. Production inference cost excludes the extra
baseline safety comparisons retained solely for the paired ablation. Experimental
spend includes every paid call. Checkpoints distinguish eligible, escalated and
pending items, so an unfinished cascade cannot claim full coverage.

Use a new tag for each run. `--replay-only` forbids model calls. `--phase` supports
pilot, confirm, common, aligned and full. The deadline and ledger path above are
run parameters, not defaults for a later experiment.

`mm-mapping-audit.ts` emits a conservative screen of reasoning/outcome mismatches
in the shipped judge. `mapping-audit-reviewed.json` records the manually checked
cases; the script validates them against recordings and counts affected items and
games by subset. This audit is diagnostic evidence, not a deployable label-based
judge correction.

Raw manifests, decisions and reports live in `mm-results`. Final interpretation
must separate pilot selection, confirmation and any partial full-DEV run.
