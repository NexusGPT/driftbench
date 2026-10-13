# JudgeBench pair-ledger measurement

This directory owns the JudgeBench row of the pre-registered pair-ledger comparison.
The complete input pool is sealed before any paid call. The core contract and its
adapter receive a separate execution freeze after the core PR is pushed and read.
No model call is permitted before that dependency lands.

## Inputs and exposure

- `data/claude.jsonl` and `data/gpt.jsonl` contain the upstream dataset files at the revision in `data/dataset-metadata.json`.
- `data/seal.json` records hashes for every input and all sampling decisions.
- `data/exposure-inventory.json` lists every audited historical recording and its hash.
- `data/prior-recorded-ids.json` is the conservative UUID union from all audited recording content.
- `data/pool.json` includes all 270 eligible Claude-response pairs in deterministic hash order.
- `data/question-overlap.json` identifies 159 overlapping source-question IDs, of which 91 have identical question text.
- The removed `codex-mm` and `astra-hard` worktrees are audited through committed git snapshots. Lost uncommitted recordings cannot be checked.
- Freshness means unseen response-pair IDs within that audit. It does not mean unseen questions or independently authored labels.

The dataset declares MIT licensing: https://huggingface.co/datasets/ScalerLab/JudgeBench.
Its Claude responses come from Claude-3.5-Sonnet. Haiku shares the response family's vendor.
The Luna cell has no response-family overlap. Both comparisons use the same model
and reasoning setting for the two contestants within a cell.

## Pre-registered evaluation

The source design registers this pool as TIE-only because it contains fewer than
440 pairs. That power statement is an expectation, not a preassigned statistical
result. An observed significant loss is still reported as a loss.

The existing GPT-4o dev split supplies all preparation inputs. None enters the
Claude test pool. Fixture, pilot and noise sets are mutually disjoint:

- Fixtures: six balanced pairs per category, three repeats. Every pair must be correct on every repeat and kappa must reach 0.8 to earn the category.
- Pilot: 20 pairs per available model, both contestants and both orders. It measures cost and throughput; it does not tune on test outcomes.
- Noise: 30 pairs, three independent repeats, both contestants and both orders. Repeat identifiers are part of every recording key.
- Cheaters: constant presented-FIRST, constant original-A, longer-wins and refusal-wins. The first two are reported separately because only the latter keeps a fixed identity after swapping.
- Validity: 10 planted arithmetic families with candidate relabelling, markdown removal, an injected position instruction and changed final answers. These checks measure mechanical invariance, not domain reasoning.
- Test: every sealed pair, both orders and both contestants. There are no content retries outside the frozen core's repair contract.

The requirement IDs are `final_correct` (hard, weight 2), `format_followed`
(weight 1), and `derivation_sound` (weight 1). The adapter calls the actual core
implementation. It must not recreate the ledger prompt or verdict rules locally.
The cheater threshold uses the same 68 preparation pairs on both sides, with one
independent baseline verdict per pair. Fixture failures do not earn a category. They cannot be hidden by a new label or
by evaluating only the categories the model passed.

The promptfoo template is the exact two-output expansion in the existing harness,
pinned to upstream commit `8014282`. `data/promptfoo-upstream-verification.json`
records the original loop template and verifies the expansion. The existing extra
user message, `Output the index now.`, is retained. No ledger schema is sent to
promptfoo because its registered answer contract is a single integer.

## Statistics and claims

A pair is correct when its two mapped game decisions have a positive net score:
correct +1, wrong -1, tie or missing 0. Every missing output is also counted as a
grader error. The pair ledger's reconciled verdict and its raw order decisions
must both be retained; the core adapter documents which games form its endpoint.

Single-rate intervals use Wilson 95% intervals. The paired difference uses a
seeded pair-level percentile bootstrap. Discordances use exact two-sided McNemar.
Holm correction is computed across the complete 18-cell family by the collator.
This row never substitutes correction across completed cells. The 18-times-p bound
is reported only as a conservative bound, never mislabeled as the final Holm p.

Jobs enter the queue in sealed order. Budget interruption reports partial coverage,
including incomplete in-flight jobs; no selection uses model outcomes.
The report publishes planned and matched counts. Missing cells do not become ties.
Costs use recorded provider usage and verified prices, or recorded Claude cost.
Unpriced calls are blocked because they cannot enforce the 25 USD cap.

## Commands

```sh
node --import tsx --test examples/ledger-jb/test/*.test.mjs
node --import tsx examples/ledger-jb/src/run.mjs --phase pilot --model claude-haiku-5-5
node examples/ledger-jb/src/report.mjs
```

The default runner only prints an offline plan. `--execute` additionally requires
`--core-dossier` and `--spend-ledger`, a committed `freeze.json`, and the frozen
adapter. A started call reserves its upper cost bound before execution. Restart
replays completed responses. An unresolved call cannot be billed again silently.
A transport error retains its reservation until reconciled.

Do not copy `node_modules`. If core integration needs dependencies, install with
`pnpm install --frozen-lockfile`. Keys are read inside the invoking command and
never written to artifacts. Gemini billing was enabled by the owner before the execution freeze. It uses medium reasoning and a 300-second timeout under the same lane cap.


## Current execution policy

The owner keeps PR 168's single schema re-ask after malformed model JSON. Transport
wrappers never retry a returned answer. Each non-quota transport failure permits
at most three attempts with a 300-second timeout. HTTP 429 adds quota waits of
60, 120 and 240 seconds, then pauses without recording a judge failure. Every
attempt retains its usage cost or conservative reservation. The owner pacing
amendment permits eight Luna HTTP calls, two Haiku calls and two Gemini calls
side by side. `parallel-remaining.mjs` uses one shared budget journal, preserves
sealed order within each model, and gates TEST on that model's preparation.
One process owns paid calls; the maximum across all three models is twelve.
Prior operational freezes and crash receipts remain in `freezes/` and `results/`.

HTTP 402 pauses the provider immediately, with no retry and no judge decision.
Only a proven prepayment rejection releases its cost hold. Other unknown costs
remain reserved. Gemini is paused until the owner confirms a top-up. The saved
successful responses stay authoritative; any resumed work fills missing requests
only. `results/billing-reconciliation/` preserves original receipts and decisions
from the pre-amendment 402 wave, plus every corrected receipt and quarantined key.
These billing failures are excluded from judge errors and measured decisions.

The owner's subsequent top-up authorizes only the frozen list of rejected keys.
One missing Gemini request probes billing before the concurrent run resumes.
Its received answer is cached under the original request identity and is not
sent again. Each old rejection advances to a new transport attempt only after
this explicit authorization. Any new 402 restores the provider circuit break.
SIGUSR2 drains the scheduler's active calls before a later runtime amendment.
