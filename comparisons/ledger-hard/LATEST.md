# Current execution contract

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
