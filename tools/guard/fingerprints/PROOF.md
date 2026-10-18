# hard-peers guard fingerprints (proof)

Scan: tools/guard/guard.mjs from PR 349 on `git archive origin/fix/integration-batch-21 comparisons/hard-peers`.
Result before: 2540 phone findings, 1 scan error (calls/old-langwatch.jsonl, 16229989 bytes, over the 10485760 limit; not fixed here).
Files: calls/promptfoo.jsonl 1878, prompts/promptfoo-pii-theirs.json 330, sets/promptfoo-pii.json 330, generate.py 2.

Proof the values are made up:
- generate.py line 62 builds every phone as `+1 415 555 0NNN` (private) or `+1 617 555 0NNN` (public), NNN = num % 1000.
- 117 of the 119 distinct matched texts match `^\+1 (415|617) 555 0\d{3}$` exactly.
- The other 2 are the template text of generate.py line 62 itself (`+1 415 555 0` and `+1 617 555 0` before the format field).
- The guard only excuses 555-0100 to 555-0199; the generator also uses 0000 to 0099 and 0200 to 0999, so those were flagged.

Apply: copy hard-peers.json to tools/guard/fingerprints/hard-peers.json on the batch 21 branch. It needs PR 349 (the mechanism) merged first.
Still open on that branch: calls/old-langwatch.jsonl is over the scan limit and needs the same split as ledger-hard (comparisons/ledger-hard/parts.py is a ready pattern).
