# Separate core-dialect variant

Gemini 3.8 Flash was dropped by the owner. Its recorded results below remain archival data, with no pending or parked continuation.

Generated 2026-10-13T11:20:33.488019+00:00. Source: `comparisons/ledger-hard/dialect/scores.json`, `decisions.json`, `attempts.jsonl` and `calls.jsonl`.

Core `2bb0a7a787ca4466ff69d204f2380a7ad19cc056`; variant seal SHA-256 `ebbc5876d5a9d482203382d33c7fa3c0ee640b6e1254bf821784004493cd85d9`. This is the same sealed case cohort under a separately frozen transport and reasoning setting, not new data. No primary request key or answer is reused.

Luna and Gemini use medium for both contestants. Candidate output uses the native core schema dialect; peer prompt bytes remain unchanged. Haiku uses the core scratchpad instruction and last-JSON candidate decoder.

| Model | Row / evidence | Paired / sealed | Ours | Peer | W | L | Exact two-sided p | Exact one-sided p | Status |
|---|---|---:|---:|---:|---:|---:|---|---|---|
| haiku | rubric/peer | 384/384 | 379 | 369 | 12 | 2 | 53/4096 = 0.012939453 | 53/8192 = 0.0064697266 | nominal lead |
| haiku | factuality/peer | 384/384 | 384 | 353 | 31 | 0 | 1/1073741824 = 9.3132257e-10 | 1/2147483648 = 4.6566129e-10 | nominal lead |
| haiku | pii/peer | 384/384 | 384 | 383 | 1 | 0 | 1 = 1 | 1/2 = 0.5 | TIE (not equivalence) |
| haiku | goal/peer | 384/384 | 384 | 192 | 192 | 0 | 1/3138550867693340381917894711603833208051177722232017256448 = 3.1861838e-58 | 1/6277101735386680763835789423207666416102355444464034512896 = 1.5930919e-58 | nominal lead |
| haiku | goal/peer-full-state | 384/384 | 384 | 346 | 38 | 0 | 1/137438953472 = 7.2759576e-12 | 1/274877906944 = 3.6379788e-12 | nominal lead |
| haiku | pooled-default/mixed | 1536/1536 | 1531 | 1297 | 236 | 2 | 14221/110427941548649020598956093796432407239217743554726184882600387580788736 = 1.2878081e-67 | 14221/220855883097298041197912187592864814478435487109452369765200775161577472 = 6.4390406e-68 | nominal lead |
| haiku | pooled-equal-evidence/mixed | 1536/1536 | 1531 | 1451 | 82 | 2 | 3571/9671406556917033397649408 = 3.6923275e-22 | 3571/19342813113834066795298816 = 1.8461637e-22 | nominal lead |
| gpt-6-luna | rubric/peer | 384/384 | 377 | 382 | 2 | 7 | 23/128 = 0.1796875 | 251/256 = 0.98046875 | TIE (not equivalence) |
| gpt-6-luna | factuality/peer | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 1 = 1 | TIE (not equivalence) |
| gpt-6-luna | pii/peer | 384/384 | 384 | 373 | 11 | 0 | 1/1024 = 0.0009765625 | 1/2048 = 0.00048828125 | nominal lead |
| gpt-6-luna | goal/peer | 384/384 | 384 | 179 | 205 | 0 | 1/25711008708143844408671393477458601640355247900524685364822016 = 3.8893845e-62 | 1/51422017416287688817342786954917203280710495801049370729644032 = 1.9446923e-62 | nominal lead |
| gpt-6-luna | goal/peer-full-state | 384/384 | 384 | 378 | 6 | 0 | 1/32 = 0.03125 | 1/64 = 0.015625 | nominal lead |
| gpt-6-luna | pooled-default/mixed | 1536/1536 | 1529 | 1318 | 218 | 7 | 2722239847673/13479973333575319897333507543509815336818572211270286240551805124608 = 2.0194698e-55 | 2722239847673/26959946667150639794667015087019630673637144422540572481103610249216 = 1.0097349e-55 | nominal lead |
| gpt-6-luna | pooled-equal-evidence/mixed | 1536/1536 | 1529 | 1517 | 19 | 7 | 15183/524288 = 0.028959274 | 15183/1048576 = 0.014479637 | nominal lead |
| gemini-3.8-flash | rubric/peer | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 1 = 1 | TIE (not equivalence) |
| gemini-3.8-flash | factuality/peer | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 1 = 1 | TIE (not equivalence) |
| gemini-3.8-flash | pii/peer | 384/384 | 384 | 384 | 0 | 0 | 1 = 1 | 1 = 1 | TIE (not equivalence) |
| gemini-3.8-flash | goal/peer | 274/384 | 274 | 138 | 136 | 0 | 1/43556142965880123323311949751266331066368 = 2.2958874e-41 | 1/87112285931760246646623899502532662132736 = 1.1479437e-41 | dropped by the owner |
| gemini-3.8-flash | goal/peer-full-state | 272/384 | 272 | 261 | 11 | 0 | 1/1024 = 0.0009765625 | 1/2048 = 0.00048828125 | dropped by the owner |
| gemini-3.8-flash | pooled-default/mixed | 1426/1536 | 1426 | 1290 | 136 | 0 | 1/43556142965880123323311949751266331066368 = 2.2958874e-41 | 1/87112285931760246646623899502532662132736 = 1.1479437e-41 | dropped by the owner |
| gemini-3.8-flash | pooled-equal-evidence/mixed | 1424/1536 | 1424 | 1413 | 11 | 0 | 1/1024 = 0.0009765625 | 1/2048 = 0.00048828125 | dropped by the owner |

| Model | Row | Wilson ours | Wilson peer | Family bootstrap difference | Inconclusive ours/peer | USD/100 ours/peer |
|---|---|---|---|---|---|---|
| haiku | rubric/peer | [96.989%, 99.443%] | [93.656%, 97.619%] | [-0.781%, 8.594%] | 5/0 | 0.053253/0.029333 |
| haiku | factuality/peer | [99.010%, 100.000%] | [88.769%, 94.255%] | [0.000%, 19.010%] | 0/0 | 0.053960/0.034993 |
| haiku | pii/peer | [99.010%, 100.000%] | [98.540%, 99.954%] | [0.000%, 0.781%] | 0/0 | 0.053808/0.031549 |
| haiku | goal/peer | [99.010%, 100.000%] | [45.024%, 54.976%] | [50.000%, 50.000%] | 0/0 | 0.059453/0.024449 |
| haiku | goal/peer-full-state | [99.010%, 100.000%] | [86.709%, 92.705%] | [0.000%, 25.000%] | 0/0 | 0.059453/0.047762 |
| haiku | pooled-default/mixed | [99.240%, 99.861%] | [82.542%, 86.167%] | [12.695%, 18.164%] | 5/0 | see rows |
| haiku | pooled-equal-evidence/mixed | [99.240%, 99.861%] | [93.208%, 95.503%] | [1.432%, 9.831%] | 5/0 | see rows |
| gpt-6-luna | rubric/peer | [96.286%, 99.114%] | [98.121%, 99.857%] | [-4.427%, 1.042%] | 2/0 | 0.015249/0.007390 |
| gpt-6-luna | factuality/peer | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] | 0/0 | 0.015123/0.010463 |
| gpt-6-luna | pii/peer | [99.010%, 100.000%] | [94.944%, 98.393%] | [0.000%, 8.594%] | 0/0 | 0.014167/0.008002 |
| gpt-6-luna | goal/peer | [99.010%, 100.000%] | [41.683%, 51.613%] | [50.000%, 60.156%] | 0/0 | 0.016474/0.015902 |
| gpt-6-luna | goal/peer-full-state | [99.010%, 100.000%] | [96.634%, 99.282%] | [0.000%, 4.167%] | 0/0 | 0.016474/0.011549 |
| gpt-6-luna | pooled-default/mixed | [99.062%, 99.779%] | [83.973%, 87.463%] | [11.914%, 16.146%] | 2/0 | see rows |
| gpt-6-luna | pooled-equal-evidence/mixed | [99.062%, 99.779%] | [98.076%, 99.207%] | [-0.586%, 2.539%] | 2/0 | see rows |
| gemini-3.8-flash | rubric/peer | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] | 0/0 | 0.179392/0.132674 |
| gemini-3.8-flash | factuality/peer | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] | 0/0 | 0.145821/0.160642 |
| gemini-3.8-flash | pii/peer | [99.010%, 100.000%] | [99.010%, 100.000%] | [0.000%, 0.000%] | 0/0 | 0.148505/0.145974 |
| gemini-3.8-flash | goal/peer | [98.617%, 100.000%] | [44.481%, 56.239%] | [47.143%, 52.364%] | 0/0 | 0.204706/0.246570 |
| gemini-3.8-flash | goal/peer-full-state | [98.607%, 100.000%] | [92.905%, 97.727%] | [0.000%, 9.929%] | 0/0 | 0.204870/0.178382 |
| gemini-3.8-flash | pooled-default/mixed | [99.731%, 100.000%] | [88.828%, 91.880%] | [8.838%, 10.244%] | 0/0 | see rows |
| gemini-3.8-flash | pooled-equal-evidence/mixed | [99.731%, 100.000%] | [98.622%, 99.568%] | [0.000%, 1.897%] | 0/0 | see rows |

9578 completed unique requests; 0 final transport failures. Variant spend USD 7.15869961. Primary plus variant measured spend USD 8.99764030 of USD 10.

Resolved model versions: ['claude-haiku-5-5', 'gemini-3.8-flash', 'gpt-6-luna'].

Exact tests and bootstrap use the original sealed statistics functions. Rows are descriptive secondary comparisons. The global 18-cell Holm table remains the collator's responsibility; conservative missing-as-one pooled adjustments are in scores.json.

All three model rows have explicit per-call raw usage. Luna pricing: USD 0.10 input, 0.01 cached input, 0.50 output per million. Gemini: USD 0.75 input and 3.75 output including thinking per million. Sources verified 2026-10-13: https://developers.openai.com/api/docs/models/gpt-6-luna and https://ai.google.dev/gemini-api/docs/pricing. Haiku uses CLI-reported cost.

Failures over 5% in a rolling 50 Luna attempts reduce variant concurrency from four to two. Every attempt and backoff is logged. Worker results are fsynced before the future returns. A drain file stops new dispatch and waits for owned requests.
