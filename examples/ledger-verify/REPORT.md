# LongJudge verify confirmation

Evidence timestamp: 2026-10-13T09:03:25.884482+00:00.

- Branch: research/ledger-verify. Core contract: PR 168 at 35f07309a4d1d1c8a7c5b176ff19e537d0ef8fdd.
- All 221 TEST items are sealed. This is a previously evaluated split, not an unseen holdout.
- Official labels are primary. The unchanged 23-correction audit is a sensitivity analysis.
- Contestants: frozen uncertainty cascade 558d75de and promptfoo llm-rubric at 8014282.
- Every returned model answer stays cached. Transport failures and partial reports remain visible.

## Strict headline and product-final scores

Accuracy intervals are Wilson 95%. Paired intervals use the frozen request-cluster bootstrap.
Strict is the headline: any output-limit hit makes the affected contestant/item an error, even if a later fallback returns a verdict.
Product-final uses the verdict the frozen product returns, including its own fallback. Both rules apply equally to both contestants.
Missing and unparsed final decisions count as wrong. An observed error is a measured outcome; a stopped run is provisional.
The output-limit column counts observed TEST completion envelopes, cascade / promptfoo. Cached reuse can affect more items than envelopes.

### Strict headline, official labels

| Model | Cascade accuracy [95% CI] | promptfoo accuracy [95% CI] | Output-limit answers: cascade / promptfoo | Wins / losses | Exact p | Holm p | Status |
|---|---|---|---|---|---|---|---|
| haiku | pending | pending | pending | pending | pending | pending | TEST pending |
| gpt-6-luna | pending | pending | pending | pending | pending | pending | TEST pending |
| gemini-3.8-flash | pending | pending | pending | pending | pending | pending | TEST pending |

### Strict headline, audited labels

| Model | Cascade accuracy [95% CI] | promptfoo accuracy [95% CI] | Output-limit answers: cascade / promptfoo | Wins / losses | Exact p | Holm p | Status |
|---|---|---|---|---|---|---|---|
| haiku | pending | pending | pending | pending | pending | pending | TEST pending |
| gpt-6-luna | pending | pending | pending | pending | pending | pending | TEST pending |
| gemini-3.8-flash | pending | pending | pending | pending | pending | pending | TEST pending |

### Product-final sensitivity, official labels

| Model | Cascade accuracy [95% CI] | promptfoo accuracy [95% CI] | Output-limit answers: cascade / promptfoo | Wins / losses | Exact p | Holm p | Status |
|---|---|---|---|---|---|---|---|
| haiku | pending | pending | pending | pending | pending | pending | TEST pending |
| gpt-6-luna | pending | pending | pending | pending | pending | pending | TEST pending |
| gemini-3.8-flash | pending | pending | pending | pending | pending | pending | TEST pending |

### Product-final sensitivity, audited labels

| Model | Cascade accuracy [95% CI] | promptfoo accuracy [95% CI] | Output-limit answers: cascade / promptfoo | Wins / losses | Exact p | Holm p | Status |
|---|---|---|---|---|---|---|---|
| haiku | pending | pending | pending | pending | pending | pending | TEST pending |
| gpt-6-luna | pending | pending | pending | pending | pending | pending | TEST pending |
| gemini-3.8-flash | pending | pending | pending | pending | pending | pending | TEST pending |

Holm correction belongs to the prespecified 18-cell family and remains pending at this handoff. No local WIN or overall superiority claim is made.
Per-item strict decisions: results/<model>.strict.json. Original product-final decisions: results/<model>.json.
Exact intervals, balanced accuracy, valid-verdict coverage and paired differences: evidence/cells.json.

## Output-limit error attribution

| Model | Contestant | TEST limit answers | TEST affected items | All-phase limit answers | All-phase affected items |
|---|---|---|---|---|---|
| haiku | driftbench-verify-uncertainty-cascade | 0 | 0 | 1 | 1 |
| haiku | promptfoo | 0 | 0 | 0 | 0 |
| gpt-6-luna | driftbench-verify-uncertainty-cascade | 0 | 0 | 0 | 0 |
| gpt-6-luna | promptfoo | 0 | 0 | 0 | 0 |
| gemini-3.8-flash | driftbench-verify-uncertainty-cascade | 0 | 0 | 0 | 0 |
| gemini-3.8-flash | promptfoo | 0 | 0 | 0 | 0 |

Unclassified historical native errors: 2. Unmapped confirmed limits: 0.
Counts refer to observed completion envelopes. Native internal attempts are not inferred from aggregate turn counts.
Receipt ids, exact reasons and request-to-item attribution: evidence/output-limit-errors.json. The strict rule is frozen in evidence/scoring-freeze.json.

## Cost, cheaters and validation

| Model | TEST cost per 100: cascade / promptfoo | Mutation preserve / flip / injection changes | Noise items with any change: cascade / promptfoo |
|---|---|---|---|
| haiku | pending / pending | pending | pending / pending |
| gpt-6-luna | pending / pending | 12/12 / 12/12 / 0 | pending / pending |
| gemini-3.8-flash | pending / pending | 12/12 / 12/12 / 0 | pending / pending |

Constant pass / fail: official 21.27% / 78.73%; audited 23.53% / 76.47%.
Mutation checks cover planted arithmetic truth only. Thresholds: preserve at least 95%, flip at least 90%, no injection changes or missing verdicts.
Noise uses 30 DEV items in three separate recording namespaces. Missing answers are reported separately in evidence/cells.json.
Cost per 100 uses unique prompt keys; actual provider fees include any duplicate paid calls. Replayed logical-call costs are separate.
Settled fees: 1.998556 USD. Unresolved-charge maximum: 9.500000 USD. Total accounted maximum: 11.498556 USD, cap 40 USD.
Fee sources: receipts/budget.json and receipts/calls.jsonl. Historical replay cost is excluded from new spend.

## Phase coverage

| Model | Pilot | Mutation fixtures | Noise 0 | Noise 1 | Noise 2 | TEST |
|---|---|---|---|---|---|---|
| haiku | 20 items; missing 0/0 | pending | pending | pending | pending | pending |
| gpt-6-luna | 20 items; missing 0/0 | 48 items; missing 0/0 | pending | pending | pending | pending |
| gemini-3.8-flash | 20 items; missing 0/0 | 48 items; missing 0/0 | pending | pending | pending | pending |

## Freeze and recovery

- Source and evidence hashes are in the immutable evidence/seal.json. The live upstream directory has no alternative verification item pool.
- All 316 upstream ids occur in prior recordings across 68 inspected files. The 221-item fallback has explicit owner approval.
- Original pilot runtime b4e4305a2426e0bb7589 is preserved. The plugin crash leaves five unknown-charge reservations totaling 3 USD.
- Subsequent 180-second API timeouts and a 240-second Haiku timeout are preserved in pilot partial reports and error receipts.
- The owner authorizes one resume of missing transport outputs for all models at 300 seconds. Returned answers are never retried.
- Maximum four provider calls globally: at most two per model, including Gemini. Atomic slots enforce this limit.
- Both API models use medium. Haiku uses claude-haiku-5-5 through local Claude processes.
- The outer process envelope includes queueing and quota backoff. Execution-only changes are recorded in evidence/execution-amendment.json.
- HTTP 429 receives waits of 60, 120 and 240 seconds. Exhausted quota remains pending transport, never a judge failure.
- The owner raises the cap to 40 USD and requires all 379 evaluation units per model: 20 pilot, 48 mutation, 90 noise and 221 TEST.
- The previous operational cutoff is removed under that full-coverage instruction before TEST.
- Native error bodies and known fees are retained. Two exhausted Haiku pilot outputs are terminal and never retried.
- A mock PATH-resolution error incurs a conservative 0.50 USD unknown-charge hold; evidence/native-test-resolution.json records it.
- Cascade prompts, parsers, pool and audit labels remain unchanged. Keys load inside provider commands from the two authorized paths.
- Dependencies are linked. No node_modules tree is copied.

| Artifact | SHA-256 |
|---|---|
| evidence/seal.json | 54fc167420330d25eb2d8874a0784bd9aa4ec4ff06fbcae82ffaa26d5fc42155 |
| evidence/runtime-freeze.json | 3e0fd15c0847368612bd6bbc5cd25d3ccb1d506c9b25866b7545b9cef255fb4c |
| evidence/pilot-runtime-freeze.json | b374d2982c6d3673c07c1f72dd4ebf96cf068981ee4e416d4a1a3311cfc3c6df |
| evidence/scoring-freeze.json | e9b9b3009ceb238349cb0c2221412c3b61fb20d9a05114c9816f61674088c275 |
| evidence/pool.json | f569c72a5e701366d232b619a623c09abddcf69cfc4379e849dbdef76b9559c5 |
| evidence/audit-map.json | 3de476f85d4ce54ed88260f62d4ccab8c0fad36cddf50c1e74e2035055541eb6 |
| stats.py | 53aa9de5e9c869e3dce17e597ba8fa7efe0a022861b99f7fd60f48d6ad3ad3ac |
| validate.py | 2b9cf4a86344562f4f4b71363a695c14893b4550f1611682e11cdf5686ce4040 |
| run.ts | 7bec4186d3e6ecbea619c9bc4bcbab4f21c6ceb56fe2e28a196056bec5b828fb |
| transport.ts | a78f0f3ead3df03f49f372d4ca49d8c006581a19db68d7c1329bac363abc9634 |
| summarize.py | 2f8d8302b34b93719c1bfddadd7239e8da44406c2a635e2cab836742f14baf46 |
| output_limits.py | d46cdc558da125fcbaa7cd19d71840287358e94098a6ee712986f847c149d120 |
| trace-requests.ts | bd51f5f85c8b8138b5713e5f40f4cfbf51eb01b63138ab25dd12085a3114ea1a |

Active runtime id: 2869d4d1f750545a2c7d. Frozen core: 35f07309a4d1d1c8a7c5b176ff19e537d0ef8fdd.
Offline checks cover source/pool hashes, exact schemas, strict replay, fail-closed missing replay and restricted Python execution.
Unit checks cover statistics, strict output-limit scoring, missing outcomes, fee capture, budget reservations, concurrency and quota backoff. Historical replay reproduces 102 verdicts with zero new model calls.
Sources: evidence/offline-checks.json, evidence/frozen-replay.json, test_stats.py, test_budget.py.
