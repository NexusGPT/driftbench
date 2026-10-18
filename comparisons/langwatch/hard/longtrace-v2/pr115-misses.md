# PR115 long-trace miss diagnosis

Status: complete. All 120 cases and all observed misses are covered. Frozen labels and original results remain unchanged.

PR115 scores 85/120 whole cases and 205/240 criteria. Native scores 110/120 whole cases and 230/240 criteria. Every PR115 receipt criterion passes scoring: 120/120. All 35 missed criteria are primary criteria.

The complete evidence artifact is [recorded/longtrace-v2-pr115-misses.json](../recorded/longtrace-v2-pr115-misses.json). Each miss includes the full frozen fixture, full recorded request frame, complete raw call/system/user/response, strict parsed result and native prediction. All request frames match every trusted fixture entry exactly after removing the native frame index; no lost events or role conversion is observed. All missed calls have successful transport.

Verified classes:

- Strict quote rejection: 25 misses. The raw ledger supplies a nonliteral evidence string; strict parsing rejects it. Examples include joining two entries with “followed by”, quoting fields as a new JSON object, or shortening the context gap message while keeping JSON object boundaries. Grounding requires the quote parts to occur in one entry; cross-event quotations cannot satisfy that rule. 24 of all misses have a raw met decision matching the frozen truth, but still lose under the frozen strict parser. This diagnostic does not rescore them.
- Reference tool requirement expansion: 9 exclusively classified misses, plus 10 total overlapping occurrences. Reasoning demands CHECK-* named in the universal reference JSON even when the criterion itself names no such tool. Actual response evidence is present. This demonstrates a scope-binding interpretation, not a transport defect. The generic “any named tool evidence” wording and unused reference toolEvent create a fixture/rubric concern; no bad label is asserted.
- Monthly scope qualification: one units miss. The model correctly converts 25000 MB to 25 GB, then objects that the deciding payload omits an explicit monthly period and plan name. The reference and target request supply that context, but the response itself contains only amount/unit and event/request IDs. This is an honest literal-rubric versus contextual-oracle concern, not an arithmetic failure or proven invalid label.

No miss is attributed to multilingual arithmetic, source resolution, transport or long-context loss without evidence. The diagnosis records what the observed raw reasoning and parser exhibit; latent causes remain unmeasured. No new calls, code changes, fixture edits or label changes occur.
