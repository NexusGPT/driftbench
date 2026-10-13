# LongJudge verify confirmation

Evidence timestamp: 2026-10-13T10:54:25.665936+00:00.

- Branch: research/ledger-verify. Core contract: PR 168 at 35f07309a4d1d1c8a7c5b176ff19e537d0ef8fdd.
- All 221 TEST items are sealed. This is a previously evaluated split, not an unseen holdout.
- The 221 TEST items contain 219 distinct questions. Bootstrap intervals cluster by the exact question text.
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

| Model | Cascade accuracy [95% CI] | promptfoo accuracy [95% CI] | Output-limit answers: cascade / promptfoo | Paired difference [95% CI] | Wins / losses | Exact p | Holm p | Status |
|---|---|---|---|---|---|---|---|---|
| haiku | pending | pending | pending | pending | pending | pending | pending | TEST pending |
| gpt-6-luna | 165/221, 74.66% [68.54%, 79.94%] | 160/221, 72.40% [66.16%, 77.87%] | 0 / 0 | 2.26% [-2.73%, 7.21%] | 18 / 13 | 0.47312966 | pending | TIE |
| gemini-3.8-flash | not run: daily quota (0/221) | not run: daily quota (0/221) | 0 / 0 (not run) | pending | pending | pending | pending | not run: daily quota |

### Strict headline, audited labels

| Model | Cascade accuracy [95% CI] | promptfoo accuracy [95% CI] | Output-limit answers: cascade / promptfoo | Paired difference [95% CI] | Wins / losses | Exact p | Holm p | Status |
|---|---|---|---|---|---|---|---|---|
| haiku | pending | pending | pending | pending | pending | pending | pending | TEST pending |
| gpt-6-luna | 188/221, 85.07% [79.77%, 89.17%] | 181/221, 81.90% [76.29%, 86.42%] | 0 / 0 | 3.17% [-1.80%, 8.11%] | 19 / 12 | 0.28104152 | pending | TIE |
| gemini-3.8-flash | not run: daily quota (0/221) | not run: daily quota (0/221) | 0 / 0 (not run) | pending | pending | pending | pending | not run: daily quota |

### Product-final sensitivity, official labels

| Model | Cascade accuracy [95% CI] | promptfoo accuracy [95% CI] | Output-limit answers: cascade / promptfoo | Paired difference [95% CI] | Wins / losses | Exact p | Holm p | Status |
|---|---|---|---|---|---|---|---|---|
| haiku | pending | pending | pending | pending | pending | pending | pending | TEST pending |
| gpt-6-luna | 165/221, 74.66% [68.54%, 79.94%] | 160/221, 72.40% [66.16%, 77.87%] | 0 / 0 | 2.26% [-2.73%, 7.21%] | 18 / 13 | 0.47312966 | pending | TIE |
| gemini-3.8-flash | not run: daily quota (0/221) | not run: daily quota (0/221) | 0 / 0 (not run) | pending | pending | pending | pending | not run: daily quota |

### Product-final sensitivity, audited labels

| Model | Cascade accuracy [95% CI] | promptfoo accuracy [95% CI] | Output-limit answers: cascade / promptfoo | Paired difference [95% CI] | Wins / losses | Exact p | Holm p | Status |
|---|---|---|---|---|---|---|---|---|
| haiku | pending | pending | pending | pending | pending | pending | pending | TEST pending |
| gpt-6-luna | 188/221, 85.07% [79.77%, 89.17%] | 181/221, 81.90% [76.29%, 86.42%] | 0 / 0 | 3.17% [-1.80%, 8.11%] | 19 / 12 | 0.28104152 | pending | TIE |
| gemini-3.8-flash | not run: daily quota (0/221) | not run: daily quota (0/221) | 0 / 0 (not run) | pending | pending | pending | pending | not run: daily quota |

Holm correction belongs to the prespecified 18-cell family and remains pending at this handoff. No local WIN or overall superiority claim is made.
Per-item strict decisions: results/<model>.strict.json. Original product-final decisions: results/<model>.json.
Exact intervals, balanced accuracy, valid-verdict coverage and paired differences: evidence/cells.json.

## Output-limit error attribution

| Model | Contestant | TEST limit answers | TEST affected items | All-phase limit answers | All-phase affected items |
|---|---|---|---|---|---|
| haiku | driftbench-verify-uncertainty-cascade | 0 | 0 | 10 | 6 |
| haiku | promptfoo | 0 | 0 | 0 | 0 |
| gpt-6-luna | driftbench-verify-uncertainty-cascade | 0 | 0 | 0 | 0 |
| gpt-6-luna | promptfoo | 0 | 0 | 0 | 0 |
| gemini-3.8-flash | driftbench-verify-uncertainty-cascade | 0 | 0 | 0 | 0 |
| gemini-3.8-flash | promptfoo | 0 | 0 | 0 | 0 |

Unclassified historical native errors: 2. Unmapped confirmed limits: 0.
Counts refer to observed completion envelopes. Native internal attempts are not inferred from aggregate turn counts.
Receipt ids, exact reasons and request-to-item attribution: evidence/output-limit-errors.json. The strict rule is frozen in evidence/scoring-freeze.json.

## Cost, cheaters and validation

| Model | TEST cost per 100: cascade / promptfoo | Mutation preserve, flip, injection changes: cascade / promptfoo | Noise items with any change: cascade / promptfoo |
|---|---|---|---|
| haiku | pending / pending | 12/12, 12/12, 0 / 12/12, 12/12, 0 | pending / pending |
| gpt-6-luna | 0.414580 / 0.067791 | 12/12, 12/12, 0 / 12/12, 12/12, 0 | 4/30 / 9/30 |
| gemini-3.8-flash | pending / pending | 12/12, 12/12, 0 / 12/12, 12/12, 0 | pending / pending |

Constant pass / fail: official 21.27% / 78.73%; audited 23.53% / 76.47%.
Mutation checks cover planted arithmetic truth only. Thresholds: preserve at least 95%, flip at least 90%, no injection changes or missing verdicts.
Noise uses 30 DEV items in three separate recording namespaces. A transition to or from a missing verdict counts as a change; missing counts are also reported in evidence/cells.json.
Cost per 100 uses unique prompt keys; actual provider fees include any duplicate paid calls. Replayed logical-call costs are separate.
Settled fees: 7.871661 USD. Unresolved-charge maximum: 17.500000 USD. Total accounted maximum: 25.371661 USD, cap 40 USD.
Fee sources: receipts/budget.json and receipts/calls.jsonl. Historical replay cost is excluded from new spend.

## Phase coverage

| Model | Pilot | Mutation fixtures | Noise 0 | Noise 1 | Noise 2 | TEST |
|---|---|---|---|---|---|---|
| haiku | 20 items; missing 0/0 | 48 items; missing 0/0 | 30 items; missing 0/0 | 30 items; missing 0/0 | pending | pending |
| gpt-6-luna | 20 items; missing 0/0 | 48 items; missing 0/0 | 30 items; missing 2/2 | 30 items; missing 0/0 | 30 items; missing 0/0 | 221 items; missing 0/0 |
| gemini-3.8-flash | 20 items; missing 0/0 | 48 items; missing 0/0 | 30 items; missing 0/0 | 30 items; missing 0/0 | pending | pending |

## Freeze and recovery

- Source and evidence hashes are in the immutable evidence/seal.json. The live upstream directory has no alternative verification item pool.
- All 316 upstream ids occur in prior recordings across 68 inspected files. The 221-item fallback has explicit owner approval.
- Original pilot runtime b4e4305a2426e0bb7589 is preserved. The plugin crash leaves five unknown-charge reservations totaling 3 USD.
- Subsequent 180-second API timeouts and a 240-second Haiku timeout are preserved in pilot partial reports and error receipts.
- The owner authorizes one resume of missing transport outputs for all models at 300 seconds. Returned answers are never retried.
- The pacing amendment replaces the earlier global four-call limit: gpt-6-luna permits eight HTTP calls, Gemini two, and native Haiku two.
- Both API models use medium. Haiku uses claude-haiku-5-5 through local Claude processes.
- The outer process envelope includes queueing and quota backoff. Execution-only changes are recorded in evidence/execution-amendment.json.
- HTTP 429 receives waits of 60, 120 and 240 seconds. Exhausted quota remains pending transport, never a judge failure.
- HTTP 402 stops Gemini pending prepaid credit replenishment. Proven billing rejection holds are released; unknown network-error holds remain.
- The owner raises the cap to 40 USD and requires all 379 evaluation units per model: 20 pilot, 48 mutation, 90 noise and 221 TEST.
- The previous operational cutoff is removed under that full-coverage instruction before TEST.
- Native error bodies and known fees are retained. Two exhausted Haiku pilot outputs are terminal and never retried.
- A mock PATH-resolution error incurs a conservative 0.50 USD unknown-charge hold; evidence/native-test-resolution.json records it.
- Cascade prompts, parsers, pool and audit labels remain unchanged. Keys load inside provider commands from the two authorized paths.
- Dependencies are linked. No node_modules tree is copied.

| Artifact | SHA-256 |
|---|---|
| evidence/seal.json | 54fc167420330d25eb2d8874a0784bd9aa4ec4ff06fbcae82ffaa26d5fc42155 |
| evidence/runtime-freeze.json | c1da047e74647cd9f61318b63e6bd5a11ecb5dc2a4c51a1887b5f039a411e52e |
| evidence/pilot-runtime-freeze.json | b374d2982c6d3673c07c1f72dd4ebf96cf068981ee4e416d4a1a3311cfc3c6df |
| evidence/scoring-freeze.json | e1c0ce28e0dc259b6fe3e3bf98e16e7e0bc20c05e621d09522f43576752fe40b |
| evidence/pool.json | f569c72a5e701366d232b619a623c09abddcf69cfc4379e849dbdef76b9559c5 |
| evidence/audit-map.json | 3de476f85d4ce54ed88260f62d4ccab8c0fad36cddf50c1e74e2035055541eb6 |
| stats.py | 53aa9de5e9c869e3dce17e597ba8fa7efe0a022861b99f7fd60f48d6ad3ad3ac |
| validate.py | 2b9cf4a86344562f4f4b71363a695c14893b4550f1611682e11cdf5686ce4040 |
| run.ts | 4dba10340b086fa8ffdecf55dde7bae9a75d1d535cb4233dfb468040f0d24767 |
| transport.ts | c621bb49d72cd20d7aa23e8b6d974026bbdae1ca6461680324098be849a3226a |
| summarize.py | 1cd18ffa8da398404528c3ffd71c351c6f67248e67b2110cd612789168dcf840 |
| output_limits.py | e497c931f8a4f395cd5edb9d3bf7ec8250b334d358d758d605cb3a23dfa2d8c6 |
| trace-requests.ts | 72e5253798d6d3b23f7a866a51b450027b23ce71fe240d775b3709d5318dd33e |

Active runtime id: ee96e47757aa837860fe. Frozen core: 35f07309a4d1d1c8a7c5b176ff19e537d0ef8fdd.
Offline checks cover source/pool hashes, exact schemas, strict replay, fail-closed missing replay and restricted Python execution.
Unit checks cover statistics, strict output-limit scoring, missing outcomes, fee capture, budget reservations, concurrency and quota backoff. Historical replay reproduces 102 verdicts with zero new model calls.
Sources: evidence/offline-checks.json, evidence/frozen-replay.json, test_stats.py, test_budget.py.

## Execution recovery and validity disclosure

- The owner confirms the Gemini top-up. One missing request probe returns an answer for 0.00151125 USD, then missing-only recovery continues at two calls.
- The probe answer is reused without another paid call. Original reports and cassettes are archived; returned answers remain cached.
- Five network no-answer entries and twenty proven billing rejections are eligible for recovery. Unknown network-charge holds remain.
- Gemini recovery keeps medium reasoning, 300-second attempts, quota waits of 60/120/240 seconds and the HTTP 402 circuit break.
- Recovery evidence: evidence/gemini-topup-resume.json and evidence/gemini-topup-recovery-check.json.
- The predeclared ten-point cheater margin is not established. On the same twenty DEV pilot items, constant-fail scores 18/20.
- Product-final cascade scores are Haiku 18/20, Luna 17/20 and Gemini 18/20. These do not clear that pilot baseline by ten points.
- The full 95-item DEV cheater gate is not freshly measured. The validityPassed field in cells.json covers planted mutation checks only.
- This documentation audit occurs after TEST starts. TEST predictions, endpoints and statistical code remain unchanged; no blanket validity or confirmatory superiority claim follows.
- Cheater disclosure source: evidence/cheater-gate-audit.json.

## Daily quota runtime amendment

- Recorded 2026-10-13T11:23:02.896066+00:00. Gemini is stopped for the owner-diagnosed daily request quota.
- Noise 2 retains 30/30 cascade and 20/30 promptfoo verdicts. Ten promptfoo verdicts remain eligible; neither contestant has started the 221-item TEST.
- Gemini TEST status: not run: daily quota, 221 items per contestant. Quota pending does not count as a judge error or a noise flip.
- Both outstanding quota calls settle at zero; their two USD reservation holds are released. Unknown historical holds remain.
- Resume requires an owner instruction or the reset near 14 October 00:00 UTC. Missing-only completion ends by 14 October 12:00 UTC.
- Medium, 300-second attempts, two Gemini calls, 60/120/240-second quota waits, the 402 circuit break, the sealed order and the 40 USD cap remain unchanged.
- The existing backoff processes make their final rejected attempts at 11:19 UTC before the resumed controller verifies they have exited. No new Gemini runner starts today.
- Sources: evidence/gemini-daily-quota-amendment.json, the archived noise-2 partial report, receipts/quota.jsonl and receipts/calls.jsonl.
