# Powered knowledge-retention confirmation

Result: **level** by the two-sided exact paired test, Holm-adjusted across the two fresh DeepEval rows.

| Pass | driftbench correct / incorrect / missing | DeepEval correct / incorrect / missing | Complete pairs | Ours-only / theirs-only correct | Exact p |
|---|---|---|---|---|---|
| Main pass | 1269 / 0 / 3 | 1227 / 0 / 45 | 1224 | 0 / 0 | 1 |
| After authorized timeout retry | 1270 / 0 / 2 | 1272 / 0 / 0 | 1270 | 0 / 0 | 1 |

Final Holm-adjusted p: 1. Missing answers are excluded from the paired test, never counted as incorrect verdicts. Level means no significant difference demonstrated; it does not establish equivalence.

## Prospective power

The independent 480-case pilot had 3 versus 0 discordances. Under the plug-in alternative q=3/480, reverse probability zero, D~Binomial(n,q). The two-sided exact p is min(1,2^(1-D)); at alpha 0.05, rejection needs D>=6.

P(D>=6) first reaches 80% at n=1264 (0.8002946742; n=1263 gives 0.7996999479). The balanced unchanged generator needs 1272 cases (53 pairs per family), yielding 0.8050032781 plug-in power. Estimated spend was $3.71 at the owner's pilot cost estimate of $0.70 per side per 480 cases.

The estimate assumes independent cases and the pilot effect holds. Three pilot discordances leave substantial uncertainty. Cases reuse templates and paired facts, so case-level independence may not hold. This calculation and test do not establish general superiority beyond this generated corpus. The pilot is not pooled into confirmation.

## Frozen protocol and provenance

- Original judge/settings freeze: `fresh-freeze.json`, commit `d44740112`, unchanged. All its source and judge-package hashes verify.
- New corpus and runner manifest committed before calls: `39ecfcf838eb38b24a65bca1c85a6b585843a115`. Unchanged generator, seed 20261214; only the knowledge set is selected.
- No transcript overlap across the 10 historical corpus blobs enumerated in `power-freeze.json`; 8233 historical request hashes blocked. Current-run shared stages are memoized and never re-billed.
- Owner authorized a symmetric single timeout retry while the main pass had completed 2 cases. The amendment was written to the dossier and committed as `9bc32875e` before the main pass ended. The original freeze is preserved.
- CLI execution uses concurrency 3. The owner then authorizes an API parity check and API completion at concurrency 16. The post-main timeout pass uses concurrency 3. Valid answers and non-timeout errors never retry. Previously unreached downstream stages execute once; a second timeout remains missing.
- The owner pauses the main pass for host saturation, then briefly resumes CLI execution before supplying a working API key. Seven completed cases and all 21 recorded CLI stages are retained. Three original pause attempts and three switch attempts are canceled without verdicts, with a combined $0.30 conservative reservation. No additional case completes during the brief CLI restart.
- Both sides use the recorded model `claude-haiku-5-5`; DeepEval stays pinned to 4.2.8 and uses its unchanged metric implementation.

## Transport parity and API disclosure

Both tools are at the ceiling on observed verdicts from this generator. The chart shows 1270 versus 1272 correct out of all 1272 scheduled cases. Two driftbench responses have invalid evidence references and remain inconclusive, without retry: `knowledge-other-person-46-b` and `knowledge-other-person-7-b`. They are not incorrect verdicts; paired inference excludes them. Chart intervals describe correct-answer yield over scheduled cases, including missing answers in the denominator.

The owner authorizes the transport change. `api/policy.json` and the deterministic 30-case selection are committed at `5d2a15114` before paid API calls: seven completed confirmation cases plus 23 id-sorted pilot cases sampled with seed 20261215. The original seven confirmation rows remain unchanged in the main pass; parity is separate from inference.

Driftbench agrees on 30/30 comparable verdicts (7/7 confirmation, 23/23 pilot). DeepEval agrees on 27/27 (4/4 confirmation, 23/23 pilot). Three original confirmation DeepEval answers are missing from CLI timeouts, so agreement is undefined there. All 60 API side verdicts are present. The small diagnostic finds no disagreement; it does not prove transport equivalence.

Both adapters send their unchanged system/user strings to `POST /v1/messages`, model `claude-haiku-5-5`, version `2023-06-01`. The API requires an output ceiling: `max_tokens=32768`. Temperature, top_p, thinking, effort, tools, cache_control and beta overrides are omitted. CLI-internal defaults and wrapper behavior are not asserted identical to API defaults. No judge criterion, prompt renderer, parser, threshold, generator or original frozen setting changes.

429 and 5xx responses retry the identical request body with backoff, jitter and Retry-After, at most eight HTTP attempts. Genuine timeouts retain the separately authorized single post-main retry. Successful fresh parity requests are reused when they resolve a timeout chain, preventing rebilling an existing answer; `api/retry/parity-reused.json` lists them. Pilot requests are forbidden in confirmation.

## Calls and cost

```json
{
  "main_calls": 2606,
  "cli_calls": 21,
  "api_main_calls": 2585,
  "parity_calls": 82,
  "retry_calls": 44,
  "parity_timeout_reuses": 2,
  "retried_timeout_requests": 2,
  "newly_reached_retry_stages": 42,
  "historical_calls": 0,
  "duplicate_completed_recordings_per_pass": 0,
  "models": [
    "claude-haiku-5-5"
  ],
  "owner_interrupted_attempts": 6,
  "owner_interrupted_cost_reservation_usd": 0.3,
  "main_cost_usd": 1.29803732,
  "parity_cost_usd": 0.02216,
  "api_usage_cost_usd": 0.8186945,
  "retry_cost_usd": 0.007800100000000001,
  "total_cost_or_reservation_usd": 1.32799742,
  "unreported_cost_reservation_usd": 0.5,
  "offline_replayed_cases": 1272,
  "fresh_replay_calls": 0
}
```

API cost is calculated from response usage at the [published rates](https://platform.claude.com/docs/en/about-claude/pricing): $0.10 input and $0.50 output per million tokens for prompts up to 100,000 tokens, fivefold above that. Cache categories use the policy's published rates if present. The total includes parity and conservative reservations for CLI attempts without billing data; it is not an exact invoice.

## Reproduction

Run `.venv/bin/python comparisons/deepeval/lead/power_score.py` for offline auditing/scoring. It rebuilds both verdicts and DeepEval request chains for all 1272 cases from recorded raw responses, with no network-backed recorder. Launch files prevent a second paid phase; durable reservations precede calls. CLI, parity, API main and timeout recovery ledgers remain separate.
