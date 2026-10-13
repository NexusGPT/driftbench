# Writing judge prompt port

The `select-best.njk` template is copied verbatim from Promptfoo's `SELECT_BEST_PROMPT`
at commit `801428268b5e421b2f6994332f6a06f86b27bb1f`.
The adjacent NOTICE contains the complete MIT notice.

`../wp-promptfoo-dev.ts` expands the two-output loop with the existing benchmark
format, fills the standard writing criterion and original question, and verifies
that all 180 DEV prompts match the untouched default contestant byte for byte.
The local harness user message remains `Output the index now.`

The direct candidate judges each order once. The one combined candidate uses
three judgments per order and the existing six-ballot `majorityPair` pool.
A tied vote remains a tie. No label enters a judging prompt.
Raw returned responses and exact keys are retained.

The executable refuses any split except DEV and any invocation cap above 1.50 USD.
Calls are awaited individually, including samples within each order.
It reserves 0.10 USD below the invocation cap.
The caller must also account for earlier task spend.

The earlier frozen holistic and its TEST confirmation remain separate artifacts.
This candidate has no TEST authorization tonight.
