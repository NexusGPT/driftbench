# LangWatch: comparison

LangWatch is an evaluation platform with a catalogue of evaluators (langevals). Scenario is its SDK for simulated user conversations, judged against a scenario. This page reads the evaluators at commit e683dd9e and the Scenario SDK at commit ad220e6a.

Results come from the comparison table. Limit means a row is not being worked, with its reason stated.

| Capability | Result | Basis | Example | Reproduce |
|---|---|---|---|---|
| Per-criterion judge rules | short tie at measured ceiling; long ahead | 2026-10-13; corrected trusted-event adapter v2; conformance candidate **not yet the shipped default**, versus native default; PR 115 is a separate approved-source default at `8195902dd20c84267f85feba268c17868e00dfbe` | Short, new seed 20261019: conformance 240/240, native 240/240; tie at measured ceiling. Model USD per 100 cases conformance/native: 0.09101203/0.10205544. Long, new seed 20261020: conformance 239/240, native 230/240; ahead. Model USD per 100 cases conformance/native: 0.45912378/0.30193896. Short: all 240 criterion labels: conformance 240/240, native 240/240 (tie at measured ceiling); all 120 primary cases: conformance 120/120, native 120/120 (tie at measured ceiling); all 120 complete vectors: conformance 120/120, native 120/120 (tie at measured ceiling). These are recorded cohort outcomes, not population-level superiority claims. Long: all 240 criterion labels: conformance 239/240, native 230/240 (ahead); all 120 primary cases: conformance 119/120, native 110/120 (ahead); all 120 complete vectors: conformance 119/120, native 110/120 (ahead). These are recorded cohort outcomes, not population-level superiority claims. Every original criterion score, including 119/120 and 59/60, remains in the defective-adapter historical grids. | Full old main/audit/native/conformance/PR 115 tables: [short](#trusted-event-adapter-v2) and [long](#preregistered-long-traces-v2). `python3 comparisons/langwatch/hard/score.py`. |
| Judge verdict prompt | short tie at measured ceiling; long ahead | 2026-10-13; corrected trusted-event adapter v2; conformance candidate **not yet the shipped default**, versus native default; PR 115 is a separate approved-source default at `8195902dd20c84267f85feba268c17868e00dfbe` | Short, new seed 20261019: conformance 120/120, native 120/120; tie at measured ceiling. Model USD per 100 cases conformance/native: 0.09101203/0.10205544. Long, new seed 20261020: conformance 119/120, native 110/120; ahead. Model USD per 100 cases conformance/native: 0.45912378/0.30193896. Short: all 240 criterion labels: conformance 240/240, native 240/240 (tie at measured ceiling); all 120 primary cases: conformance 120/120, native 120/120 (tie at measured ceiling); all 120 complete vectors: conformance 120/120, native 120/120 (tie at measured ceiling). These are recorded cohort outcomes, not population-level superiority claims. Long: all 240 criterion labels: conformance 239/240, native 230/240 (ahead); all 120 primary cases: conformance 119/120, native 110/120 (ahead); all 120 complete vectors: conformance 119/120, native 110/120 (ahead). These are recorded cohort outcomes, not population-level superiority claims. Every original criterion score, including 119/120 and 59/60, remains in the defective-adapter historical grids. | Full old main/audit/native/conformance/PR 115 tables: [short](#trusted-event-adapter-v2) and [long](#preregistered-long-traces-v2). `python3 comparisons/langwatch/hard/score.py`. |
| Judge decision phase | limit | compared against their docs or code. Not applicable: driftbench blocks are fixed, so there is no per-turn decision step. | No example recorded in the evidence. | No reproduction recorded in the evidence. |
| Simulated user prompt | ahead | 2026-10-13; intent-gated candidate, **not yet the shipped default**, versus exact default text prompt | Hard: shipped 116/120 (coverage 120/120), candidate 120/120 (coverage 120/120), default 96/120 (coverage 120/120). Fresh seed 20261013: shipped 60/60 (coverage 60/60), candidate 60/60 (coverage 60/60), default 43/60 (coverage 60/60). Candidate/default fresh Wilson 95%: 93.98% to 100.00% / 59.23% to 81.49%. Model USD per 100 (shipped/candidate/default): hard 0.030019/0.053737/0.028401; fresh 0.030361/0.055607/0.030503. A requested email must be supplied, otherwise withheld. This is one-step disclosure; native reversed history is coalesced for the CLI. | `python3 comparisons/langwatch/hard/score.py`; `simulator.mts` hard/fresh replay in the hard README. |
| Script succeed() and fail() | equal | compared against their docs or code | LangWatch's succeed() or fail() ends the run from any step. Ours ends it after the block before the call. Later blocks stay in the spec and are reported as skipped, not failed. | `npx vitest run packages/core/test/script.test.ts packages/users/test/scripted.test.ts`. Not reproducible from main yet: the mid-spec stop test is not in any pull request yet. |
| Caching | ahead | compared against their docs or code | LangWatch's cache client offers get, set and claim, with no per-block key view. Ours prints each block's cache key under the block in the report, or "not cached". A new suite name starts from an empty cache. | `npx vitest run packages/core/test/runner/run.test.ts -t "another suite"`. `npx vitest run packages/cli/test/campaign.test.ts -t cache-suite`. Not reproducible from main yet: the per-block key test is not in any pull request yet. |
| Seeding | ahead | compared against their docs or code | Ours draws from a seed. No seeded draw was found on LangWatch's side. | No reproduction recorded in the evidence. |
| exact_match | ahead | measured head-to-head | A reply with a line break where the reference has a space ("Thanks." then a line break then "Yes", against "Thanks. Yes", hand-labelled pass): LangWatch fails it because it keeps the line break. Ours passes it, because each run of whitespace becomes one space. | `npx vitest run packages/checks/test/exact.test.ts`, test "reads a line break and a space as the same gap". Not reproducible from main yet: the measurement script is awaiting merge (PR 69). |
| ROUGE and BLEU | ahead | measured head-to-head. The ragas profile matches the reference to 1e-9 on 8 pairs, and the verdict shows both profiles side by side by default, which the reference does not. | The verdict quotes the reference profile and our default profile side by side. The reference profile follows the ragas definitions. | `npx vitest run packages/checks/test/overlap.test.ts` |
| Pairwise comparison | ahead | 2026-10-13; audit plus fact-ledger candidate, **not yet the shipped default**, versus native golden-aware default | Hard: shipped 106/120 (coverage 120/120), candidate 120/120 (coverage 120/120), default 119/120 (coverage 120/120). Fresh seed 20261013: shipped 41/60 (coverage 60/60), candidate 60/60 (coverage 60/60), default 58/60 (coverage 60/60). Candidate/default fresh Wilson 95%: 93.98% to 100.00% / 88.64% to 99.08%. Model USD per 100 (shipped/candidate/default): hard 0.052081/0.079854/0.039216; fresh 0.074542/0.085096/0.073255. Both orders are scored. The previous 120/120 is the development result; the fresh sixty-pair result is separate. Easy cohort: candidate/default both 120/120. | `python3 comparisons/langwatch/hard/score.py`; hard replay in `pairwise/AUDIT.md`, fresh replay in the hard README. |
| Prompt-injection and jailbreak detection | in progress | 2026-10-13; measured frozen target/action audit candidate, **not yet the shipped default**; native unmeasured | Hard: shipped 117/120 (coverage 120/120), candidate 103/120 (coverage 120/120). Fresh: shipped 57/60 (coverage 60/60), candidate 51/60 (coverage 60/60) (95% 73.89% to 91.90%). Model USD per 100 shipped/candidate: hard 0.048042/0.104584; fresh 0.048527/0.115235. LangWatch's defaults use Azure Content Safety Jailbreak Detection and Prompt Shield. Both native sets stay unmeasured without Azure keys; no proxy or competitor accuracy is inferred. | `python3 comparisons/langwatch/hard/score.py`; runnable native adapter in `comparisons/langwatch/hard/injection/README.md`. |
| PII detection | ahead | 2026-10-13; full-scope audit candidate, **not yet the shipped default**, versus actual native Presidio defaults | Hard: shipped 108/120 (coverage 120/120), candidate 120/120 (coverage 120/120), default 88/120 (coverage 120/120). Fresh seed 20261013: shipped 55/60 (coverage 60/60), candidate 60/60 (coverage 60/60), default 45/60 (coverage 60/60). Candidate/default fresh Wilson 95%: 93.98% to 100.00% / 62.77% to 84.22%. Model USD per 100 (shipped/candidate/default): hard 0.041539/0.083044/0.000000; fresh 0.044897/0.090957/0.000000. Enabled-scope subset, shipped/candidate/native: hard 79/90 (coverage 90/90)/90/90 (coverage 90/90)/88/90 (coverage 90/90); fresh 41/46 (coverage 46/46)/46/46 (coverage 46/46)/45/46 (coverage 46/46). Native PERSON/LOCATION defaults disable thirty name/home positives on hard and fourteen on fresh; every ID is named in `comparisons/langwatch/hard/native-scope-misses.md`. Remaining native misses: two phones on hard, one on fresh. Native en_core_web_lg 3.7.1, spaCy 3.7.5, Presidio 2.2.364. The full margin includes scope differences. The shipped component baseline uses the explicit reserved-domain benchmark opt-in; the bare name/address judge and its declared scope are recorded separately. | `python3 comparisons/langwatch/hard/score.py`; native adapters and pinned dependencies in `comparisons/langwatch/hard/pii/README.md`. |
| Retrieval metrics (faithfulness, context precision and recall) | limit | compared against their docs or code. Not applicable: our blocks carry no retrieved contexts. | No example recorded in the evidence. | No reproduction recorded in the evidence. |
| Annotation anchors | equal | compared against their docs or code | A label can point at a message, a tool call, a field of a tool's JSON output, a runtime event, or a timeline call. A tool call keeps the OpenTelemetry span id that the adapter supplies, and its anchor resolves to that span. | `npx vitest run packages/judges/test/anchors.test.ts packages/cli/test/view-anchor.test.ts packages/adapters/test/traces/otel.test.ts`. Not reproducible from main yet: the span anchor test is not in any pull request yet. |
| Annotation queues with assignment and scores | equal | compared against their docs or code | A queue item keeps each reviewer's score with the label. The scale is set per criterion in driftbench.yaml, and a score outside it is refused. | `npx vitest run packages/judges/test/queue.test.ts packages/cli/test/aggregate-config.test.ts`. Not reproducible from main yet: the test is awaiting merge (PR 69) for packages/cli/test/view-scale.test.ts. |
| Dataset model | equal | compared against their docs or code | LangWatch keeps dataset rows in a database, edited in its platform UI. Ours keeps spec files under version control with a content hash, so a change is a reviewable diff. | No reproduction recorded in the evidence. |
| Multi-turn red-team attacker (Crescendo, GOAT) | equal | compared against their docs or code | Ported from Scenario's red-team agent at commit ad220e6: one objective over many turns, each reply scored 0 to 10, and a stop with a failure verdict after two consecutive scores of 9 or more. Ours seeds the encoding draw and replays a recording with no model call. Their backtracking, which erases a refused exchange from the agent's history, is not ported. No head-to-head run was measured. | `npx vitest run packages/users/test/redteam-agent.test.ts`. See [multi-turn red-team user](../redteam-agent.md). |

## Approved PR 115 pairwise default

The original shipped-contract result stays above. PR 115 is approved to replace it once CI is green; this section does not assert that it is merged or current. The actual measured source is `8195902dd20c84267f85feba268c17868e00dfbe`. The ignored source checkout is excluded from this comparison commit.

| Cohort | Original shipped contract | PR 115 default | Audit candidate | Native default |
|---|---|---|---|---|
| Hard 120 | 106/120 (coverage 120/120) (95% 81.37% to 92.92%) | 120/120 (coverage 120/120) (95% 96.90% to 100.00%) | 120/120 (coverage 120/120) (95% 96.90% to 100.00%) | 119/120 (coverage 120/120) (95% 95.43% to 99.85%) |
| Fresh 60, seed 20261013 | 41/60 (coverage 60/60) (95% 55.77% to 78.69%) | 60/60 (coverage 60/60) (95% 93.98% to 100.00%) | 60/60 (coverage 60/60) (95% 93.98% to 100.00%) | 58/60 (coverage 60/60) (95% 88.64% to 99.08%) |

Model USD per 100, original/PR 115/audit/native (Hard 120): 0.052081/0.087975/0.079854/0.039216.

Model USD per 100, original/PR 115/audit/native (Fresh 60, seed 20261013): 0.074542/0.088901/0.085096/0.073255.

## Approved PR 115 criterion default

The same approved-source round also measures PR 115's actual criterion default at `8195902dd20c84267f85feba268c17868e00dfbe`. Old main shipped, original audit candidate, native default and PR 115 stay separate. The frozen fresh cohort is the original 60-case draw at seed 20261013; its labels and original losses are unchanged. This is an approved-source measurement, not a claim that the PR is merged or current.

| Cohort and metric | Old main shipped | Original audit candidate | Native default | PR 115 default |
|---|---|---|---|---|
| Hard 120, Primary criterion | 116/120 (coverage 120/120) (95% 91.74% to 98.70%) | 117/120 (coverage 120/120) (95% 92.91% to 99.15%) | 120/120 (coverage 120/120) (95% 96.90% to 100.00%) | 119/120 (coverage 120/120) (95% 95.43% to 99.85%) |
| Hard 120, Complete vector | 102/120 (coverage 120/120) (95% 77.53% to 90.30%) | 112/120 (coverage 120/120) (95% 87.39% to 96.58%) | 120/120 (coverage 120/120) (95% 96.90% to 100.00%) | 119/120 (coverage 120/120) (95% 95.43% to 99.85%) |
| Frozen fresh 60, seed 20261013, Primary criterion | 56/60 (coverage 60/60) (95% 84.07% to 97.38%) | 59/60 (coverage 60/60) (95% 91.14% to 99.71%) | 60/60 (coverage 60/60) (95% 93.98% to 100.00%) | 59/60 (coverage 60/60) (95% 91.14% to 99.71%) |
| Frozen fresh 60, seed 20261013, Complete vector | 50/60 (coverage 60/60) (95% 71.97% to 90.69%) | 57/60 (coverage 60/60) (95% 86.30% to 98.29%) | 60/60 (coverage 60/60) (95% 93.98% to 100.00%) | 59/60 (coverage 60/60) (95% 91.14% to 99.71%) |

Model USD per 100, old main/audit/native/PR 115 (Hard 120): 0.083222/0.102776/0.103213/0.087322. Both metric views reuse the same run attribution.

Model USD per 100, old main/audit/native/PR 115 (Frozen fresh 60, seed 20261013): 0.084715/0.104277/0.107008/0.088025. Both metric views reuse the same run attribution.

| Procedure | Hard primary / vector | Frozen fresh primary / vector |
|---|---|---|
| Old main shipped | 116/120 (coverage 120/120) / 102/120 (coverage 120/120) | 56/60 (coverage 60/60) / 50/60 (coverage 60/60) |
| Original audit candidate, not yet shipped | 117/120 (coverage 120/120) / 112/120 (coverage 120/120) | 59/60 (coverage 60/60) / 57/60 (coverage 60/60) |
| Native default | 120/120 (coverage 120/120) / 120/120 (coverage 120/120) | 60/60 (coverage 60/60) / 60/60 (coverage 60/60) |
| PR 115 default | 119/120 (coverage 120/120) / 119/120 (coverage 120/120) | 59/60 (coverage 60/60) / 59/60 (coverage 60/60) |

Defective mixed-role adapter: serialized user/context/tool text is collapsed into an agent entry. These retained criterion counts are not reliable pure-quality comparisons. All old main/audit/native/PR 115 hard/fresh values, including 119/120 and 59/60, remain unchanged.

Completed [PR 115 miss analysis](../../comparisons/langwatch/hard/pr115-misses.md) records cross-entry evidence stitching on hard and a deciding-evidence gap treated as vacuous compliance on fresh. Mixed-role adapter framing limits the latter conclusion.

## Superseded unmeasured criterion plans

Conformance seed 20261018 and long-trace seed 20261014 are retained construction artifacts. Neither plan was called; neither has measured accuracy. They are superseded by the trusted-event seed 20261019 and long v2 seed 20261020 cohorts. No old mixed-role criterion result is a reliable pure-quality comparison.

## Trusted event adapter v2

New seed 20261019: all 120 cases and all 240 constructed criterion labels are fixed before calls. Trusted event roles come from fixture construction; role-like text stays literal inside its owning entry. Every procedure runs once with unchanged prompts and decoders. Audit and conformance remain candidates, not yet the shipped default. This cohort is separate from the retained defective-adapter results; no old labels, losses or pairwise measurements are revised.

| Metric | Old main default | Original audit candidate | Native default | Conformance candidate | PR 115 default |
|---|---|---|---|---|---|
| Primary: all 240 criteria | 213/240 (Wilson 95% 84.13% to 92.15%; coverage 240/240) | 229/240 (Wilson 95% 91.98% to 97.42%; coverage 240/240) | 240/240 (Wilson 95% 98.42% to 100.00%; coverage 240/240) | 240/240 (Wilson 95% 98.42% to 100.00%; coverage 240/240) | 238/240 (Wilson 95% 97.01% to 99.77%; coverage 240/240) |
| Primary criterion: all 120 cases | 114/120 (Wilson 95% 89.52% to 97.69%; coverage 120/120) | 118/120 (Wilson 95% 94.13% to 99.54%; coverage 120/120) | 120/120 (Wilson 95% 96.90% to 100.00%; coverage 120/120) | 120/120 (Wilson 95% 96.90% to 100.00%; coverage 120/120) | 118/120 (Wilson 95% 94.13% to 99.54%; coverage 120/120) |
| Secondary: receipt, all 120 cases | 99/120 (Wilson 95% 74.72% to 88.26%; coverage 120/120) | 111/120 (Wilson 95% 86.36% to 96.00%; coverage 120/120) | 120/120 (Wilson 95% 96.90% to 100.00%; coverage 120/120) | 120/120 (Wilson 95% 96.90% to 100.00%; coverage 120/120) | 120/120 (Wilson 95% 96.90% to 100.00%; coverage 120/120) |
| Secondary: complete vector, all 120 cases | 93/120 (Wilson 95% 69.24% to 84.05%; coverage 120/120) | 109/120 (Wilson 95% 84.33% to 94.80%; coverage 120/120) | 120/120 (Wilson 95% 96.90% to 100.00%; coverage 120/120) | 120/120 (Wilson 95% 96.90% to 100.00%; coverage 120/120) | 118/120 (Wilson 95% 94.13% to 99.54%; coverage 120/120) |

Short-cohort outcome: all 240 criterion labels: conformance 240/240, native 240/240 (tie at measured ceiling); all 120 primary cases: conformance 120/120, native 120/120 (tie at measured ceiling); all 120 complete vectors: conformance 120/120, native 120/120 (tie at measured ceiling). These are recorded cohort outcomes, not population-level superiority claims.

Completed [short-seed PR 115 miss analysis](../../comparisons/langwatch/hard/adapter-v2-pr115-misses.md) and [full inputs/raw calls](../../comparisons/langwatch/hard/recorded/adapter-v2-pr115-misses.json) identify two evidence-contract losses: `judge-coverage_order-06` quotes frame metadata and synthesizes a chronology quote; `judge-conditional_promise-10` stitches context and agent quotes across entries. Both CLI calls succeed and semantic `met` flags are correct, but the strict request-aware parser rejects the evidence strings as ungrounded. These remain scored invalid-output losses. This diagnosis applies only to new short seed 20261019; no long-cohort cause is claimed.

| Procedure | Model USD per 100 cases | Attributable model USD | Registration commit |
|---|---|---|---|
| Old main default | 0.08375475 | 0.10050570 | `c17fa5fa6df5893f7de1f312ada6d599fd9c2db9` |
| Original audit candidate | 0.10326267 | 0.12391520 | `c17fa5fa6df5893f7de1f312ada6d599fd9c2db9` |
| Native default | 0.10205544 | 0.12246653 | `c17fa5fa6df5893f7de1f312ada6d599fd9c2db9` |
| Conformance candidate | 0.09101203 | 0.10921444 | `c17fa5fa6df5893f7de1f312ada6d599fd9c2db9` |
| PR 115 default | 0.09027308 | 0.10832770 | `c17fa5fa6df5893f7de1f312ada6d599fd9c2db9` |

Fixture SHA-256: `6b0b59034c43f7390587207262db6d33a8030498222f68604a3b733205eae6d9`. The complete adapter/procedure hashes match the original preregistered freeze; PR 115 uses source `8195902dd20c84267f85feba268c17868e00dfbe`. Metric views reuse each recorded cohort run, so costs are not added again for receipt/vector/criterion views. Invalid quality verdicts remain losses; recorded unrecovered transport failures remain unscored with full coverage shown. Shared synthetic families limit generalization.

Protocol: [trusted adapter contract](../../comparisons/langwatch/hard/ADAPTER-V2-CONTRACT.md).

Post-run storage formatting is verified separately in [formatting migration](../../comparisons/langwatch/hard/final-format-migration.json): archived original bytes and registration commits retain the measured hashes, JSON labels are deeply equal, TypeScript significant tokens agree, and the root verifier certifies unchanged model inputs for all 2163 recorded request references. Canonical formatting does not replace the original measurement stamps.

## Preregistered long traces v2

New seed 20261020: all 120 cases and all 240 constructed criterion labels are fixed before calls. Trusted event roles come from fixture construction; role-like text stays literal inside its owning entry. Every procedure runs once with unchanged prompts and decoders. Audit and conformance remain candidates, not yet the shipped default. This cohort is separate from the retained defective-adapter results; no old labels, losses or pairwise measurements are revised.

| Metric | Old main default | Original audit candidate | Native default | Conformance candidate | PR 115 default |
|---|---|---|---|---|---|
| Primary: all 240 criteria | 227/240 (Wilson 95% 90.95% to 96.81%; coverage 240/240) | 235/240 (Wilson 95% 95.22% to 99.11%; coverage 240/240) | 230/240 (Wilson 95% 92.50% to 97.72%; coverage 240/240) | 239/240 (Wilson 95% 97.68% to 99.93%; coverage 240/240) | 205/240 (Wilson 95% 80.39% to 89.32%; coverage 240/240) |
| Primary criterion: all 120 cases | 111/120 (Wilson 95% 86.36% to 96.00%; coverage 120/120) | 115/120 (Wilson 95% 90.62% to 98.21%; coverage 120/120) | 110/120 (Wilson 95% 85.34% to 95.41%; coverage 120/120) | 119/120 (Wilson 95% 95.43% to 99.85%; coverage 120/120) | 85/120 (Wilson 95% 62.16% to 78.22%; coverage 120/120) |
| Secondary: receipt, all 120 cases | 116/120 (Wilson 95% 91.74% to 98.70%; coverage 120/120) | 120/120 (Wilson 95% 96.90% to 100.00%; coverage 120/120) | 120/120 (Wilson 95% 96.90% to 100.00%; coverage 120/120) | 120/120 (Wilson 95% 96.90% to 100.00%; coverage 120/120) | 120/120 (Wilson 95% 96.90% to 100.00%; coverage 120/120) |
| Secondary: complete vector, all 120 cases | 107/120 (Wilson 95% 82.34% to 93.56%; coverage 120/120) | 115/120 (Wilson 95% 90.62% to 98.21%; coverage 120/120) | 110/120 (Wilson 95% 85.34% to 95.41%; coverage 120/120) | 119/120 (Wilson 95% 95.43% to 99.85%; coverage 120/120) | 85/120 (Wilson 95% 62.16% to 78.22%; coverage 120/120) |

Long-cohort outcome: all 240 criterion labels: conformance 239/240, native 230/240 (ahead); all 120 primary cases: conformance 119/120, native 110/120 (ahead); all 120 complete vectors: conformance 119/120, native 110/120 (ahead). These are recorded cohort outcomes, not population-level superiority claims.

Completed [long-seed PR 115 miss analysis](../../comparisons/langwatch/hard/longtrace-v2/pr115-misses.md) and [full inputs/raw calls](../../comparisons/langwatch/hard/recorded/longtrace-v2-pr115-misses.json) cover all 35 primary losses: 25 strict quote rejections, nine reference-tool requirement expansions and one monthly-scope qualification. All 120 receipt criteria pass. Twenty-four raw semantic decisions match frozen truth but retain their strict-parser losses. The reference-tool and monthly-scope cases expose fixture/rubric interpretation concerns; the diagnosis does not declare labels wrong or rescore results.

| Procedure | Model USD per 100 cases | Attributable model USD | Registration commit |
|---|---|---|---|
| Old main default | 0.39744008 | 0.47692810 | `c17fa5fa6df5893f7de1f312ada6d599fd9c2db9` |
| Original audit candidate | 0.41291700 | 0.49550040 | `c17fa5fa6df5893f7de1f312ada6d599fd9c2db9` |
| Native default | 0.30193896 | 0.36232675 | `c17fa5fa6df5893f7de1f312ada6d599fd9c2db9` |
| Conformance candidate | 0.45912378 | 0.55094854 | `c17fa5fa6df5893f7de1f312ada6d599fd9c2db9` |
| PR 115 default | 0.51337425 | 0.61604910 | `c17fa5fa6df5893f7de1f312ada6d599fd9c2db9` |

Fixture SHA-256: `a6e66b7e1b53ab6a63fdc714e2f26c8db671a92a40b01179c8dcdefc6342b029`. The complete adapter/procedure hashes match the original preregistered freeze; PR 115 uses source `8195902dd20c84267f85feba268c17868e00dfbe`. Metric views reuse each recorded cohort run, so costs are not added again for receipt/vector/criterion views. Invalid quality verdicts remain losses; recorded unrecovered transport failures remain unscored with full coverage shown. Shared synthetic families limit generalization.

Protocol: [trusted adapter contract](../../comparisons/langwatch/hard/ADAPTER-V2-CONTRACT.md). [Long v2 preregistration](../../comparisons/langwatch/hard/longtrace-v2/PREREGISTRATION.md).

Post-run storage formatting is verified separately in [formatting migration](../../comparisons/langwatch/hard/final-format-migration.json): archived original bytes and registration commits retain the measured hashes, JSON labels are deeply equal, TypeScript significant tokens agree, and the root verifier certifies unchanged model inputs for all 2163 recorded request references. Canonical formatting does not replace the original measurement stamps.

## Measurement limits

- Candidates are not yet the shipped default. Corrected criterion rows use the complete new short/long cohorts; original hard/fresh counts remain in the qualified historical grids.
- Original fresh cohorts use seed 20261013; injection repair uses 20261017. Trusted-event validation uses seed 20261019 and long v2 uses 20261020. Old seed 20261018/20261014 plans remain unmeasured. Labels and candidate procedures are frozen before calls. No held-out tuning occurs.
- Every old criterion comparison uses the defective mixed-role adapter. All counts, including 119/120 and 59/60, remain unchanged as historical records; they do not establish pure judge-quality rankings.
- Shared generator families are correlated. Wilson intervals describe these instances and do not prove population-level superiority.
- Empty native CLI output is a transport failure. Recovery precedes scoring; unrecovered cases remain unscored with coverage shown.
- Native Azure classifiers and OpenAI moderation remain unmeasured in this round. Dry source parity proves request construction, not live accuracy.
- Native PII disabled entities account for thirty hard and fourteen fresh misses. Enabled-scope scores appear separately.
- Hard Sonnet, Scenario decision/cache runtime and live trace import are not measured in this round.
- The `request_sha256` field migration is storage-only: request hash values, input bytes, outcomes and attributed costs remain unchanged. Original parent history is retained.
- Sanitization findings: [initial scan](../../comparisons/langwatch/hard/recorded/gitleaks-before.json) and [long-trace scan](../../comparisons/langwatch/hard/recorded/gitleaks-longtrace-before.json). See [final verification](../../comparisons/langwatch/hard/verification.md) for actual scan/check results; these links do not assert a scan pass.

Additional upstream scope limits: the native annotation queue interface and Scenario cache view are not measured. The cache comparison reads the key-value client; no live cache run is claimed.
