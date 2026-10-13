# Trusted fixture event adapter v2

Owner authorization: preserve published PR115119/120hard and59/60fresh; correct mixed-role adapters using structured fixture events, never parsing bracket tokens into roles. Fixed adapters run only on NEW preregistered seeds, all contestants once, with labels committed before any call. No fresh tuning.

Root owns generate-judges-entries-v2.py, criteria-v2.mts, score/report integration and all calls/git. Existing hard_injection worker owns ONLY longtrace-v2/**. Not alone: never revert others, edit old fixtures/procedures or make model calls/commits.

Short-row fixed-adapter validation: new seed20261019,120cases, unchanged original judge generator skill families/oracle plus explicit construction-time entries. All five procedures: old main default, original audit, native default, conformance candidate, PR115 default. Compare this new untouched cohort separately from old defective-adapter hard120/fresh60 results. All payloads use trusted event roles; no truth,id,kind enters model requests.

Long cohort: copy the original construction method into longtrace-v2/ at NEWseed20261020,120cases, same family/oracle design. Preserve old seed14 artifacts as unmeasured. Emit trusted TranscriptEntry objects from construction (agent,user,context,tool_call,tool_result), never a parser over serialized bracket tags. Embedded role-like text remains literal in its owning entry. This additional cohort and its labels/protocol/tests must be committed before any call, all five procedures once. Root owns source/procedure freezing and runtime.

Worker preflight: Plumbing; contract this file; inputs original longtrace/generate.py,test_construction.py,PREREGISTRATION.md; own output longtrace-v2/**; assertions deterministic generation, all240oracle labels, full schema, absent deciding evidence, literal role-like text, tool order, receipt identity, mutations; delivery existing isolated worktree; root reviewer; inherited model. No recorded-output inspection, modelcalls, commits or package edits. Return actual hashes/counts and tests. New filename/version before structural rework, old artifacts untouched.

Role definitions derive from event construction. Do not infer roles from strings or replace occurrences of [agent]. A context gap with nested [agent] remains one context entry. The long final serialized trace may be JSON of entries; compare every contestant on the same trusted visible events with unchanged default prompts/decoders. Labels fixed by construction before runs.
