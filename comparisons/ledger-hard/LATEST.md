# Current execution contract

Detached supervisor PID `76375` runs Sol then Sonnet after each provider gate. Log: `comparisons/ledger-hard/detached-supervisor.log`. State: `supervisor-state.json`. Both approved crash keys now have one replacement answer each, and their original USD 0.10 holds remain. `gpt-6.1-sol/host-crash-recovery-verification.json` records the receipts.

Gemini 3.8: dropped by the owner on 13 Oct 2026, partial data kept, not reported as a score. No Gemini 3.8 request remains pending and no resume is permitted. Flash Lite remains the Gemini result. `gemini-3.8-owner-drop.json` preserves the recording hashes.

The detached supervisor runs Sol and Sonnet one at a time at concurrency two, under the ten-probe gate and unchanged caps. It waits through outages and session limits. `supervisor-amendment.json` records the owner authorization and source hashes. Two named host-lost Sol requests are authorized for one replacement answer each; USD 0.10 of old holds remains. `gpt-6.1-sol/host-crash-recovery.json` lists their keys.

## Historical amendments

The Gemini 3.8 drop above supersedes all older resume and pending-work statements below.

The construction audit passes the 1,536 cases sealed at `eeb7875e`. No pool is withdrawn.

The owner permits one re-ask of the 20 keys in `crash-recovery.json`. Each has one final recorded answer. The lost attempts retain USD 0.40 reserve, separate from measured spend. The report lists every key.

The owner now limits the combined primary and dialect runs to four calls total. Existing workers drain before this limit takes effect. Queue rotation keeps Haiku independent of the remote providers. The dialect Luna limit remains adaptive four/two, nested under the combined four-call cap. Primary Luna retains its frozen provider-default reasoning; dialect Luna uses medium for both contestants.

Sources and original seals stay fixed. Execution amendments describe only operational changes. `resume.py` writes each answer durably before releasing its worker. No answered call is retried. Unanswered transport failures receive up to three attempts with 10/30-second backoff.

The combined USD 10 cap includes measured usage, the USD 0.40 lost-attempt reserve, and reservations for active calls. Only the two owner-named API key files are used, read inside each worker.

Later quota amendment: Gemini is limited to two calls, within the combined four-call cap. HTTP 429 receives waits of 60, 120 and 240 seconds. Exhausted quota retries remain pending, never scored as judge failures. This overrides the general three-attempt rule for HTTP 429 only.

Later pacing amendment: after a natural drain, per-model limits replace the combined four-call cap and earlier adaptive pacing. Shared across both experiments: gpt-6-luna eight plain HTTP calls, Gemini two calls, Haiku two calls. All three run side by side. The sealed order, USD 10 cap, contracts and quota retry waits remain unchanged. `pacing-amendment.json` freezes the runtime change.

Billing amendment: Gemini is paused for prepaid credit depletion, confirmed by HTTP 402. The 532 empty rejections received before the pause are preserved byte-for-byte in `dialect/billing-rejections.jsonl`, excluded from answers and scoring. They carry no reported usage and release their call holds. No 402 is retried. Haiku and Luna continue; Gemini resumes missing-only after an explicit owner top-up confirmation. The USD 0.40 crash reserve remains.

Top-up amendment: the owner confirms restored Gemini credit. The single missing request named in `gemini-topup.json` returns an answer, recorded once; `gemini-probe-result.json` records its USD 0.0014235 cost. Gemini resumes missing-only at two calls, retaining the 429 waits and 402 circuit break. `topup-runtime-amendment.json` also fixes drain-state reporting without changing any request or scoring contract.

Budget amendment: the owner approves USD 12 solely to finish the same sealed requests. `budget-amendment.json` supersedes the original USD 10 cap at runtime. The USD 0.40 crash reserve remains. Nothing else changes.

Daily quota amendment: Gemini stops on the shared 10,000-request daily limit. Two quota-only backoffs are abandoned without an HTTP call in flight. The 262 missing requests remain eligible, with no judge failures attributed to quota. The owner extends the Gemini missing-only cutoff to 2026-10-14 12:00 UTC. Resume only on explicit owner word or after the reset near 2026-10-14 00:00 UTC. The USD 12 cap and all sealed requests remain unchanged. Partial tables publish complete Haiku and Luna results now.

Owner-only hold amendment: the owner supersedes automatic release after the daily reset. Gemini resumes only on explicit owner word. Exactly 262 unique requests remain, including both abandoned no-answer requests; zero additional content re-asks are planned and all 20 crash re-asks are recorded. The missing split is goal candidate 110, default peer 40, equal-evidence peer 112. Future no-answer transport retries may add attempts. The existing cutoff and cap remain unchanged.

Separate Flash-Lite amendment: the owner authorizes gemini-3.5-flash-lite on all 384 cases per row in both primary and dialect experiments, with both contestants and the equal-evidence goal ablation. It has a separate USD 4 allocation; the overall cap rises to USD 16. The committed flash-lite/seal.json freezes 6,560 unique requests, medium reasoning if accepted and provider default only after an explicit unsupported-setting rejection, eight calls, 429 waits 20/60/180 seconds, and immediate 402 stop. Pricing read 2026-10-13 is USD 0.30 input, 0.03 cached input, and 2.50 output including thinking per million tokens, from https://ai.google.dev/gemini-api/docs/pricing. Gemini 3.8 was dropped by the owner; the 262 unrun requests are archival, not pending work.

Flash-Lite budget amendment: the owner approves USD 8 for the same sealed Flash-Lite requests and USD 20 overall. The original USD 12 allocation covers the prior experiments; Gemini 3.8 completion was dropped by the owner. flash-lite/budget-amendment.json records the runtime source overrides. No model setting, case, prompt, request order or statistics changes.

Flash-Lite final budget amendment: the owner approves USD 9 and USD 21 overall. Its 6,560 unique requests are complete. Gemini 3.8 was dropped by the owner; no continuation is scheduled.

Added models: `sonnet-5-5/seal.json` and `gpt-6.1-sol/seal.json` freeze the same cases for both experiments, with medium reasoning for both contestants. Sonnet has a USD 45 cap including holds; Sol has a USD 25 cap including holds. Sonnet uses the cheaper five-call pilot route with `DISABLE_PROMPT_CACHING=1`; the first ten distinct pilot answers remain counted once. Total generated tokens are capped at 4,096, including reasoning.

Latest network amendment: `network-amendment.json` replaces the previous circuit rules for the added models. Ten consecutive unpaid provider probes, at least thirty seconds apart, permit resumption at concurrency two, one model at a time. Three consecutive connection-class failures cause a ten-minute pause and a fresh probe gate. Missing-only recovery cycles have no fixed limit. Every answer, receipt and unknown-cost hold stays durable. `network-resume.py` runs Sol, then Sonnet. The stop-new-call lever is `network-hold`; in-flight calls drain. No added-model score is published while a request lacks a model answer.

Closed-result clarification: `closed-cell-reporting-amendment.json` preserves the official Luna primary result, including six original transport-only requests counted inconclusive. The accepted USD 0.001804 cache-write fee changes costs only. The six requests may be recovered after Sonnet and Sol, only after a separate freeze and only as a labelled post-close addendum beside the unchanged official result.
