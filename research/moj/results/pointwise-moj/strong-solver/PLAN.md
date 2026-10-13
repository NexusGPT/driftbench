# Stronger solver, bounded blind Verify round

- Hypothesis: replacing only the Luna solver with gpt-6.1-sol or claude-sonnet-5-5 improves the fixed solve-and-compare design.
- Refuting bar: official validation accuracy must exceed 42/49 plus the recorded 3.3-point noise proxy, with nonzero pass recall. At least 44/49 is required.
- Only the 95 blind Verify practice entries enter this run: 46 tuning, 49 validation, split moj-split-v2. No reference-guided inputs or sealed data enter prompts.
- Solver system prompt is SOLVE_SYSTEM from moj/experts.py, verbatim. The solver sees only the question. Jev sees question, generated final answer truncated to 600 characters, and candidate, with the original match question.
- Both new solvers use medium reasoning. No OpenAI temperature parameter. Sonnet uses the local CLI with DISABLE_PROMPT_CACHING=1 and no tools, skills, MCP, or repository context.
- Budget guard: 10 USD for this new round, maximum two in-flight item tasks across providers. A 16,384-output-token safety cap bounds reservations; this is a transport budget limit, not a prompt change. CLI per-call budget is 0.50 USD. Truncated outputs remain recorded and are not retried.
- First ten tuning probes per model are deterministic question-length quantiles. They are reused, never requested again. Require ten healthy structured answers and comparisons per model before collecting the remaining tuning items.
- Selection: maximum official tuning accuracy subject to pass recall at least 50 percent, then balanced accuracy, then higher threshold. Five grouped tuning folds diagnose generalization. Apply the identical rule to recorded Luna and both new solvers. Freeze before new validation calls. Also report the historical fixed-0.5 rule as an ablation.
- Corrected labels are the already frozen eight proof contradictions in label-audit/report.json. No corrected label enters threshold fitting. No claims extend beyond those checks.
- OpenAI standard short-context rates verified at https://developers.openai.com/api/docs/pricing on 2026-10-13: input 2.00, cached read 0.10, cache write 2.50, output 10.00 USD per million. Reasoning is included in output. Sonnet uses the CLI's reported total cost. Unknown costs keep reservations.
- Record requests, answers, errors, usage and spend in this directory. Use unchanged moj/client.py for S1. Returned malformed answers are terminal. An uncertain transport outcome is not resubmitted.
- Stop after this round. Preserve the three accepted terrain cells and all previous results.
