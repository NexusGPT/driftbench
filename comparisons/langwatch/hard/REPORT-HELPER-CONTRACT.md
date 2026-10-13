# Report generator additions

Exclusive owner: existing hard_pii worker. Root reviews outputs and owns commits/calls.

| Unit | Class | Contract | Inputs | Verification | Output | Delivery | Reviewer | Model |
|---|---|---|---|---|---|---|---|---|
| Report generator additions | Plumbing | This file | score.py, summary.json, update-page.py, write-report.py, frozen records, pr115.mts, compliance.mts, longtrace.mts | Python syntax; assert produced counts match summary; missing studies omitted | update-page.py, write-report.py, report-helper.md | Exclusive files in existing isolated worktree | Root | Existing inherited model |

Only own update-page.py and write-report.py. No paid calls, no formatting other files, no commits, no final report writes. Root owns score.py and all runners. Not alone: do not revert others.

Add separate PR 115 default hard120/fresh60 table keyed pairwise-pr115 and pairwise-pr115-heldout. Read actual recorded sourceCommit (8195902dd20c84267f85feba268c17868e00dfbe). Old shipped41/60 is main old contract; PR115 approved replacing it once CIgreen. Never call PR115 merged/current unless actually verified. Native and audit candidate scores remain side by side. Costs actual summary attribution.

Add conformance candidate table keyed judges-compliance-primary/-vector and judges-compliance-heldout-v2-primary/-vector, plus baseline judges-ours-heldout-v2 and judges-theirs-heldout-v2 with corresponding suffix. Existing original audit losses stay visible. Newfreshseed20261018 uses same unchanged generator,60fixedlabels. Candidate label not yet the shipped default. Report hard plus new fresh, costs and intervals. Include actual completeness guards, omit only if no study records exist, reject partial records.

Extend longtrace tables to fourth contestant compliance, candidate not yet shipped. Registered original ours/audit/theirs plus compliance run once. Ceiling native120 is separated from actual candidate losses; remove inaccurate whole-row ceiling tie prose. Headline all240criterioncounts, all120primary, receipt/vector secondary. No selective favorable subgroups.

Keep scope/provenance disclaimers, originaleasy/hard/fresh measurements, allcosts and honest losses. Add storage-only request_sha256 migration note, originalparent retained, gitleaks results linked without claiming scanpass before verification record. Existing hard source packages unchanged; freshignoredPR115checkout excluded from commit.

After edits, compile both Python files, inspect diff and write report-helper.md with files changed and validation. Do not run final report generators while measurements are incomplete. Use no em/en dashes.

## Approved additional PR115 criterion measurement

Latest owner request adds PR115 criterion default once on hard120/frozenfresh60
in the same approved source round as pairwise. Records: judges-pr115.json and
judges-pr115-heldout.json. Keys: judges-pr115[-heldout]-primary/-vector.
Report the fourth procedure beside original shipped, original audit and native
default, with hard/fresh primary/vector counts, actual CIs/costs, pinned source
and complete record guards. Preserve all original losses. If PR115 still loses,
root reads actual misses and writes pr115-misses.md; link that actual diagnosis
without claiming unobserved causes. Do not tune any fresh set or candidate.
