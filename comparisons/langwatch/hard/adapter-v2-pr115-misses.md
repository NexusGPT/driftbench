# Approved PR 115 misses with the trusted adapter v2

Status: complete for new short seed20261019. Long-seed diagnosis is separate and remains pending until its complete run.

Source: approved8195902dd20c84267f85feba268c17868e00dfbe. This is the new preregistered120-case validation cohort, not a rerun of original hard120/fresh60. All240constructed labels are fixed before calls. PR115 scores118/120primary,120/120receipt,118/120complete vectors and238/240individual criteria. Native and conformance each score240/240; conformance is **not yet the shipped default**. Original119/120 and59/60 remain unchanged and qualified by the historical mixed-role adapter defect.

Both new misses are successful CLI calls with correct semantic reasoning and correct `met` flags. The strict request-aware parser rejects their evidence strings and returns unparsed inconclusive results. Invalid output is a quality/contract loss under the frozen scoring rule. Neither is a transport failure or a mislabeled missing-evidence case. No new-set outcome changes a prompt, parser, adapter, fixture or label.

| Case | Expected | Raw flag | Parsed prediction | Cause class |
|---|---|---|---|---|
| judge-coverage_order-06 | pass | met=true | invalid/null | Frame metadata quoted as evidence; synthesized cross-entry chronology quote |
| judge-conditional_promise-10 | fail | met=false | invalid/null | Context and agent quotes stitched into one evidence string |

For coverage_order-06, trusted tool_result `covered=true` precedes the distinct agent offer `I offer plan R788359.`. The model correctly reasons about that order. Its evidence combines invented compact JSON frames with the words `followed by`. Evidence must quote entry text, not frame metadata or a synthesized sequence; the parser reports `invalid criterion ledger: the evidence quote is not in the supplied data`.

For conditional_promise-10, trusted context states no customer approval, the separate submit_order tool call submits orderR310660, and the agent confirms submission before asking for confirmation. The model correctly sets met=false. Its evidence joins quoted context and agent fragments with a semicolon. The whole combined evidence string occurs in no supplied entry, so the same strict grounding check rejects it.

The complete fixture, rendered prompts, raw ledger text and parsed records are in [raw miss inputs](recorded/adapter-v2-pr115-misses.json). The original two-miss handoff remains [unchanged](pr115-criterion-misses-inputs.jsonl). These observations name reproduction classes for future production work; they do not tune or reinterpret this frozen validation run.
