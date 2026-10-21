# Declared fulfillment routing — v8 confirmation

Only `criterion.intent: request-fulfillment` is eligible for the semantic gate. Eligibility is a literal typed-field check. No metric name, benchmark identifier, text match or word list participates. A metric without that declaration runs the established task program without an extra classifier call. The generic manifest loader preserves an existing response-relevance declaration as metric intent when it removes the explicit assessment contract.

The writing and objective programs were compared with frozen source `a96d10f108a432828464fe4f50214ef44ce6c645`, replaying the same recorded model responses. Every exact model request (system, user, schema, reasoning, token and budget fields) and the entire request array have identical SHA-256 hashes in five writing and five JudgeBench cases. This proves program preservation; it does not claim independently sampled model answers will be identical. The prior all-metric gate failed the writing identity checks in run [39584023270](https://github.com/NexusGPT/driftbench/actions/runs/39584023270). Both identity suites passed in run [39585594216](https://github.com/NexusGPT/driftbench/actions/runs/39585594216) (127 focused tests passed; the diagnostic job later stopped on formatting).

| Set / case prefix | Calls | Old and final sequence SHA-256 |
|---|---:|---|
| writing `6c7b822b8263` | 3 | `01fe469da6e6f9115a649385b6282d05f43e98934763921887eda46d41a04a48` |
| writing `25bb938e951b` | 4 | `8850e3acbf3ea6c0651b57b43abeb20200b8b51e6049bf58890987ebc32df5bb` |
| writing `6e238cb223f8` | 4 | `df5747aa42a60ff8aa07db90aafd4d23a7e5c6f60e5fe010f2cf76d6a3e7baed` |
| writing `a21446b5855f` | 4 | `cfb3aece2ff3365dc4fa951a76dc5fe0b43cbcf3f21f8bd305fe60524c013b81` |
| writing `30ece39ad0de` | 3 | `fb3bfe1b422fa4fe57700994ddf413c3f79ea6fe27c3cc26e1ffc74c15f183bd` |
| jb `9f662634-6bf` | 3 | `caa2f3e3324f87c57d8a5506e848a0599c71f780a87fcd5fd5f319911ba51da7` |
| jb `63497830-5de` | 3 | `fe2ae8336009e1beb12ae0fe473cd2f031c08bbc8f293be556a3068ea14bbcd1` |
| jb `8dddf27e-b2f` | 3 | `a7029c88bd5a01a0f28ec6b669243c08b297f97d233ffb62886962179729a913` |
| jb `6bc9bd9d-322` | 3 | `d479194aeb076c822852a147c888db622101cd9a874ae970d097fb54234d07c9` |
| jb `c186e988-285` | 3 | `4ba3a6fa08be34cc6e2434a1994b617ae5d9118bc13d26961a02b80e95700809` |

The fixture inputs, response tapes and frozen hashes are in `packages/judges/test/fixtures/default-{writing,jb}-sequence*.json`. The complete request arrays are preserved in the linked diagnostic artifact. No live writing calls were made for this proof.

## Final eligible metric

| Measurement | Correct | Failures | Inconclusive | Reported USD |
|---|---:|---:|---:|---:|
| Declared v8 strict relevance, settings `449dcc75bc3a` | 480/480 | 0 | 0 | 0.2458338 |
| Prior v7 with explicit response relevance | 479/480 | — | — | historical |
| Original default without intent routing | 475/480 | 0 | 1 | historical |

All 480 final cases used the relevance obligation ledger. The recorded peer remains 451/480 on exactly the same frozen population. The current paired discordances are 29 default-only correct and 0 peer-only correct: exact two-sided p = 3.725290298461914e-9, Holm p = 7.450580596923828e-9 across the unchanged strict-relevance/knowledge-retention family. This significance statement applies to that comparison, not to all public benchmarks.

| Regression case | Default | Explicit relevance | Forced criterion | Forced relevance |
|---|---:|---:|---:|---:|
| `relevancy-explicit-unknown-8-b` | 5/5 | 5/5 | 0/5 | 5/5 |
| `relevancy-promise-3-b` | 5/5 | 5/5 | 0/5 | 5/5 |
| `relevancy-promise-18-b` | 5/5 | 5/5 | 0/5 | 5/5 |
| `relevancy-followup-9-a` | 5/5 | 5/5 | 5/5 | 5/5 |
| `relevancy-promise-8-b` | 5/5 | 5/5 | 0/5 | 5/5 |

The final 100-judgment regression confirmation cost USD 0.0542020. These are final-design measurements; earlier all-intent or ungated experiments are superseded.

## Preserved measurements and chart units

The other fourteen README datasets and all five core benches contain zero eligible metrics. Their existing published measurements and native chart units are retained by construction, following the owner decision. No resolved-pair re-scoring is substituted for presentation-game accuracy or MM-Eval macro scoring. Only the strict-relevance row and its existing chart are refreshed, and the unchanged charts receive the linked identity sentence.

The original writing control runs were 114, 111 and 107 of 173 (mean 110.67, sample SD 3.51). The superseded all-metric gate ran 105, 105 and 106 (mean 105.33, sample SD 0.58); its paired evidence was borderline and was not declared harmless noise. The final eligibility restriction removes its classifier call from writing. Writing preservation now follows the byte-identical request proof, with no further writing repeats.

JudgeBench control runs were 241 and 244 of 270; the declared-gate run was 237/270 with the same objective program. Its five request sequences match frozen a96. Remaining repeats were stopped at the owner’s request. The stopped 147-case partial file is excluded from scores and means; its known charges remain in the private spend ledger.
