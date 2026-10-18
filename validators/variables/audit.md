# Variables bank: independent audit pending

The pilot, cause review and planted-bug checks remain pending for the blind bank handoff.
The cheater failure records the independent PR review; no builder-issued audit pass is claimed.
Only the independent auditors may replace them with verdicts under docs/validators.md section 12.7.

| Check | Verdict | Note |
|---|---|---|
| blind pilot | pending | A separate executor must wire the adapter after the store/planner PRs merge, then record iteration 0 and ten real-component iterations. |
| cheater | fail | Review at 6c6c0d933 found a call-order shortcut passing 30/330 items (issuecomment-6243139200). The corrective scheduling and regression tests await independent re-review; the builder does not replace this verdict with a pass. |
| cause review | pending | 66 declared cause names across 330 items; no independent sample of 30 real failing items and no reviewed distinct-cause count. |
| planted bugs | pending | Twenty harness-response mutations are tested. No auditor has planted twenty bugs in the real component. |

## Evidence boundary

- Blind authoring: only the two authorized documentation files and existing ladder formats were read;
  the author never read the store/planner source or tests, nor diffs for PRs 706, 719, 753, 756, 757 or 758.
- The bank has 330 items, 30 per family, 66 per tier. These are descriptor counts, not production passes.
- The real iteration-0 score, pilot score, mean improvement, forecast, failing causes and floor are unknown.
- No journal is fabricated from the scripted adapter. No floor or existing registry is changed.
- The 100 distinct-failing-cause gate cannot be claimed from 66 labels. Extend the bank following real
  failing-item review; do not inflate cause names to make the arithmetic pass.
- The hardness gate is **pending and must fail closed** until every audit check passes and section 12.4 holds.

## Next owner

The integration seat implements the three ports described in
`packages/validators/src/ladders/variables/README.md`: `validateVariableStore`, `verifyVariableQuotes`,
and `planV2` plus `renderPlanV2`. The independent pilot follows once the relevant PRs merge.
Interview and feed readers have no API contract in the frozen permitted document; add their items only
after a documented public contract is available. The author does not infer one from implementation code.

## Call-order correction

The review reproducer is retained in the harness. Before enabling the repaired scheduler, its zero-pass
assertion failed on seeds 1, 20 and 820020691: the previous scheduler admitted 30/330 items on each. Item order and answer positions use separate seeded
permutations. Every item preserves its original probes and adds contrasting repeats; a residue check
excludes every answer motif of periods 1–8. The regression family exercises every period and offset,
with global and per-item counters and otherwise-valid canned replies across all three adapter calls.
Budget-prefix comparisons are checked with either result arriving first.

This is a harness repair. The independent cheater re-review and real-component pilot remain outstanding.

## Request-hash correction

The second review (head 8ca988569) found a guess from the request alone: SHA-256 of the quote request, minus the
fixture version and the agent nonce, modulo three, chosen as success, quote-not-found or unreadable. It passed 2 of
330 items on every seed, because a quote item had only three different requests once the nonce was removed and
every seed sent the same three. The cheater verdict stays **fail**: only an independent re-review may change it.

What changed in the bank: a quote item now asks in four independent scenes (twelve different requests), each with
its own file layout, words and way of being wrong, so the normalized requests differ inside an item and across
seeds. The guess is retained as a regression for all eight digest words: it passes zero quote items on seeds 1 to
20, 820020691 and the commit-derived hidden seed (before the change it passed 2 on each seed for word 0). A second
test asserts twelve different normalized requests per quote item and none shared between two seeds. No item was
dropped or weakened; the scripted adapter still passes all 330 items on every seed.

