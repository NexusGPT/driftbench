# Fresh criterion-ledger hard rows

The primary study keeps the frozen d7f5e226 criterion-ledger candidate and pinned promptfoo templates unchanged. Four original construction rows each have 384 fresh cases, two seeded generations of 192. Every family and label is balanced. This is a synthetic stress test, not broad evidence of general superiority.

Run `python3 comparisons/ledger-hard/construct.py` once to write the immutable seal. Commit the seal and all bound files before calling `run.py --execute`. `run.py --limit 20 --execute` is a cost and transport pilot retained in the primary cohort; no outcome tuning is allowed. Then `run.py --execute` fills only missing, never-started requests. Every attempt is journaled before dispatch. Failed requests are not retried. `score.py` is free replay. `python3 -m unittest discover -s comparisons/ledger-hard -p 'test_*.py'` tests the contract and statistics.

Haiku uses the original Claude print-mode flags. gpt-6-luna uses the OpenAI API, provider-default reasoning, temperature omitted, and reports tokens with unpublished pricing. Both contestants share settings. Gemini is pending billing. Measured USD is capped at 10 with reservations for in-flight Haiku calls. No node_modules is copied.

Goal default and equal-evidence ablation are both reported. Pooling replaces the goal comparison when showing equal evidence; it never double-counts it. Exact tests and family bootstrap are frozen in score.py. Global 18-cell Holm claims belong to the collator. A dialect variant is separate and awaits the pair-ledger core.
