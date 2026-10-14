"""Audit and score the powered confirmation without model calls; publish its chart input."""
import json
import math
import os
from pathlib import Path

import power_run as power
from power_retry import available_summary, timeout
import power_api as api

ROOT = power.OUT
lead = power.lead


def audit(main, after, cases):
    expected = {c["id"] for c in cases}
    for run in [main, after]:
        if len(run["rows"]) != len(expected) or {r["id"] for r in run["rows"]} != expected:
            raise ValueError("Incomplete or duplicate case results")
    truth = {c["id"]: c["truth"] for c in cases}
    for row in after["rows"]:
        if row["truth"] != truth[row["id"]]:
            raise ValueError("Truth changed")
    cli = list(lead.records(ROOT / "calls.jsonl"))
    api_main = api.rows(api.API / "main" / "calls.jsonl")
    parity = api.rows(api.API / "parity" / "calls.jsonl")
    fresh_parity = {r["request_sha256"]: r for r in parity if r["case"].startswith("power/")}
    original = cli + api_main
    retries = api.rows(api.API / "retry" / "calls.jsonl")
    old = {r["request_sha256"]: r for r in original}
    new = {r["request_sha256"]: r for r in retries}
    if len(old) != len(original) or len(new) != len(retries):
        raise ValueError("Duplicate paid request within a pass")
    if any(not timeout(old[k]) for k in old.keys() & new.keys()):
        raise ValueError("Retried a non-timeout request")
    if set(new) & {r["request_sha256"] for r in parity if not r.get("error")}:
        raise ValueError("Re-billed an already-answered parity request")
    prior = set(json.loads((ROOT / "prior-request-hashes.json").read_text()))
    if prior & (old.keys() | new.keys()):
        raise ValueError("Historical request re-billed")
    for row in original + retries + parity:
        if lead.call_key("haiku", row["system"], row["user"]) != row["request_sha256"]:
            raise ValueError("Request hash mismatch")
        if row.get("transport") == "anthropic-messages-api" and "usage" in row:
            if not math.isclose(row["charged_usd"], api.usage_cost(row["usage"]), abs_tol=1e-12):
                raise ValueError("Usage cost mismatch")
            body = {"model": api.MODEL, "max_tokens": api.MAX_TOKENS, "system": row["system"],
                    "messages": [{"role": "user", "content": row["user"]}]}
            if power.digest(json.dumps(body, ensure_ascii=False).encode()) != row["body_digest"]:
                raise ValueError("API body digest mismatch")
    models = {k for row in cli for k in row.get("envelope", {}).get("modelUsage", {})}
    models.update(row["envelope"]["model"] for row in api_main + retries + parity if "envelope" in row)
    if models != {"claude-haiku-5-5"}:
        raise ValueError(f"Unexpected model set: {models}")
    combined = fresh_parity | old | new
    reused = json.loads((api.API / "retry" / "parity-reused.json").read_text())
    for key in reused:
        if key not in old or not timeout(old[key]) or key not in fresh_parity or fresh_parity[key].get("error"):
            raise ValueError("Invalid parity retry reuse")
        combined[key] = fresh_parity[key]
    for row in after["rows"]:
        for side in ["ours", "theirs"]:
            if not row[side]["request_sha256s"] or any(k not in combined for k in row[side]["request_sha256s"]):
                raise ValueError("Result references an absent recording")
    checkpoint = json.loads((api.API / "checkpoint.json").read_text())
    before_by_id = {r["id"]: r for r in main["rows"]}
    for row in checkpoint["rows"]:
        if row != before_by_id[row["id"]]:
            raise ValueError("Changed completed checkpoint case")
    total = sum(r["charged_usd"] for r in original + retries + parity) + api.PAUSE_RESERVE
    if total > power.CAP:
        raise ValueError("Spend cap exceeded")
    replay_check(after["rows"], cases, combined)
    return {"main_calls": len(original), "cli_calls": len(cli), "api_main_calls": len(api_main),
            "parity_calls": len(parity), "retry_calls": len(retries), "parity_timeout_reuses": len(reused),
            "retried_timeout_requests": len(old.keys() & new.keys()),
            "newly_reached_retry_stages": len(new.keys() - old.keys()),
            "historical_calls": 0, "duplicate_completed_recordings_per_pass": 0, "models": sorted(models),
            "owner_interrupted_attempts": 6,
            "owner_interrupted_cost_reservation_usd": api.PAUSE_RESERVE,
            "main_cost_usd": sum(r["charged_usd"] for r in original) + api.PAUSE_RESERVE,
            "parity_cost_usd": sum(r["charged_usd"] for r in parity),
            "api_usage_cost_usd": sum(r["charged_usd"] for r in api_main + retries + parity if "usage" in r),
            "retry_cost_usd": sum(r["charged_usd"] for r in retries),
            "total_cost_or_reservation_usd": total,
            "unreported_cost_reservation_usd": sum(r["charged_usd"] for r in original + retries + parity if r.get("cost_is_reservation")) + api.PAUSE_RESERVE,
            "offline_replayed_cases": len(cases), "fresh_replay_calls": 0}


def replay_check(result_rows, cases, combined):
    """Rebuild both predictions and DeepEval stage chains from raw recordings only."""
    from copy import deepcopy
    prompts = lead.render(cases, {"relevancy": "response-relevance", "knowledge": "default"})
    copied = deepcopy(result_rows)
    api.parse_ours(copied, prompts)
    for expected, replay in zip(result_rows, copied):
        if expected["ours"].get("prediction") != replay["ours"].get("prediction"):
            raise ValueError("Driftbench parse replay mismatch")
        key = lead.call_key("haiku", prompts[expected["id"]]["system"], prompts[expected["id"]]["user"])
        if expected["ours"]["request_sha256s"] != [key]:
            raise ValueError("Driftbench request chain mismatch")
        if not expected["ours"].get("error") and expected["ours"].get("raw") != combined[key]["result"]:
            raise ValueError("Driftbench raw response mismatch")

    class Replay:
        def call(self, system, user):
            key = lead.call_key("haiku", system, user)
            self.keys.append(key)
            if key not in combined:
                raise RuntimeError("Unrecorded replay request: " + key)
            row = combined[key]
            if row.get("error"):
                raise ValueError(row["error"])
            return row["result"]

    rec = Replay()
    measure = lead.metrics(rec)
    lookup = {c["id"]: c for c in cases}
    for row in result_rows:
        rec.keys = []
        try:
            answer = measure("knowledge retention", lookup[row["id"]])
        except ValueError:
            answer = {"prediction": None}
        if answer["prediction"] != row["theirs"].get("prediction") or rec.keys != row["theirs"]["request_sha256s"]:
            raise ValueError("DeepEval prediction/chain replay mismatch: " + row["id"])


def main():
    frozen, cases, _ = power.verify()
    before = json.loads((api.API / "main" / "results.json").read_text())
    after = json.loads((api.API / "retry" / "results.json").read_text())
    if not after.get("retry_complete"):
        raise ValueError("Retry pass incomplete")
    evidence = audit(before, after, cases)
    pre, post = available_summary(before["rows"]), available_summary(after["rows"])
    scores_path = power.ROOT / "fresh-scores.json"
    scores = json.loads(scores_path.read_text())
    paired = post["paired"]
    n = len(cases)
    if not paired["n"]:
        raise ValueError("No complete paired cases")
    score = {"row": "knowledge retention", "n": n, "paired_n": paired["n"],
             "ours": post["ours"]["correct"], "theirs": post["theirs"]["correct"],
             "ours_ci": lead.wilson(post["ours"]["correct"], n), "theirs_ci": lead.wilson(post["theirs"]["correct"], n),
             "ours_only_right": paired["ours_only_right"], "theirs_only_right": paired["theirs_only_right"],
             "paired_p": paired["paired_p"], "setting": "default", "run": "power/api/retry/results.json",
             "corpus": f"fresh, unchanged generate.py seed {frozen['seed']}, {frozen['pairs_per_family']} pairs per family",
             "total_cases": len(cases), "excluded_missing": paired["excluded_missing"],
             "ours_unparsed": post["ours"]["missing"], "theirs_unparsed": post["theirs"]["missing"],
             "ours_distinct_inputs": len(cases),
             "theirs_distinct_inputs": len({tuple(r["theirs"]["request_sha256s"]) for r in after["rows"]}),
             "cost_usd": evidence["total_cost_or_reservation_usd"],
             "cost_note": "Includes conservative reservations for calls without reported billing",
             "power_calculation": "power/power-calculation.json",
             "missing_policy": "Missing answers excluded from paired test; counts reported separately",
             "before_retry": pre, "after_retry": post}
    scores = [score if r["row"] == "knowledge retention" else r for r in scores]
    order = sorted(range(len(scores)), key=lambda i: scores[i]["paired_p"])
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1, (len(scores)-rank)*scores[i]["paired_p"]))
        scores[i]["paired_p_holm"] = running
    score["outcome"] = ("ahead" if score["ours"] > score["theirs"] else "behind") if score["paired_p_holm"] <= .05 and score["ours"] != score["theirs"] else "level"
    power.dump(scores_path, scores)
    power.dump(ROOT / "audit.json", {"before": pre, "after": post, "evidence": evidence,
                                     "paired_p_holm": score["paired_p_holm"], "outcome": score["outcome"]})
    lines = ["# Powered knowledge-retention confirmation", "", f"Result: **{score['outcome']}** by the two-sided exact paired test, Holm-adjusted across the two fresh DeepEval rows.", "",
             "| Pass | driftbench correct / incorrect / missing | DeepEval correct / incorrect / missing | Complete pairs | Ours-only / theirs-only correct | Exact p |",
             "|---|---|---|---|---|---|"]
    for label, summary in [("Main pass", pre), ("After authorized timeout retry", post)]:
        counts = lambda s: " / ".join(str(summary[s][k]) for k in ["correct", "incorrect", "missing"])
        p = summary["paired"]
        lines.append(f"| {label} | {counts('ours')} | {counts('theirs')} | {p['n']} | {p['ours_only_right']} / {p['theirs_only_right']} | {p['paired_p']:.10g} |")
    lines += ["", f"Final Holm-adjusted p: {score['paired_p_holm']:.10g}. Missing answers are excluded from the paired test, never counted as incorrect verdicts. Level means no significant difference demonstrated; it does not establish equivalence.", "",
              "## Prospective power", "", "The independent 480-case pilot had 3 versus 0 discordances. Under the plug-in alternative q=3/480, reverse probability zero, D~Binomial(n,q). The two-sided exact p is min(1,2^(1-D)); at alpha 0.05, rejection needs D>=6.", "",
              "P(D>=6) first reaches 80% at n=1264 (0.8002946742; n=1263 gives 0.7996999479). The balanced unchanged generator needs 1272 cases (53 pairs per family), yielding 0.8050032781 plug-in power. Estimated spend was $3.71 at the owner's pilot cost estimate of $0.70 per side per 480 cases.", "",
              "The estimate assumes independent cases and the pilot effect holds. Three pilot discordances leave substantial uncertainty. Cases reuse templates and paired facts, so case-level independence may not hold. This calculation and test do not establish general superiority beyond this generated corpus. The pilot is not pooled into confirmation.", "",
              "## Frozen protocol and provenance", "",
              "- Original judge/settings freeze: `fresh-freeze.json`, commit `d44740112`, unchanged. All its source and judge-package hashes verify.",
              "- New corpus and runner manifest committed before calls: `39ecfcf838eb38b24a65bca1c85a6b585843a115`. Unchanged generator, seed 20261214; only the knowledge set is selected.",
              "- No transcript overlap across the 10 historical corpus blobs enumerated in `power-freeze.json`; 8233 historical request hashes blocked. Current-run shared stages are memoized and never re-billed.",
              "- Owner authorized a symmetric single timeout retry while the main pass had completed 2 cases. The amendment was written to the dossier and committed as `9bc32875e` before the main pass ended. The original freeze is preserved.",
              "- CLI execution uses concurrency 3. The owner then authorizes an API parity check and API completion at concurrency 16. The post-main timeout pass uses concurrency 3. Valid answers and non-timeout errors never retry. Previously unreached downstream stages execute once; a second timeout remains missing.",
              "- The owner pauses the main pass for host saturation, then briefly resumes CLI execution before supplying a working API key. Seven completed cases and all 21 recorded CLI stages are retained. Three original pause attempts and three switch attempts are canceled without verdicts, with a combined $0.30 conservative reservation. No additional case completes during the brief CLI restart.",
              "- Both sides use the recorded model `claude-haiku-5-5`; DeepEval stays pinned to 4.2.8 and uses its unchanged metric implementation.", "",
              "## Transport parity and API disclosure", "",
              "Both tools are at the ceiling on observed verdicts from this generator. The chart shows 1270 versus 1272 correct out of all 1272 scheduled cases. Two driftbench responses have invalid evidence references and remain inconclusive, without retry: `knowledge-other-person-46-b` and `knowledge-other-person-7-b`. They are not incorrect verdicts; paired inference excludes them. Chart intervals describe correct-answer yield over scheduled cases, including missing answers in the denominator.", "",
              "The owner authorizes the transport change. `api/policy.json` and the deterministic 30-case selection are committed at `5d2a15114` before paid API calls: seven completed confirmation cases plus 23 id-sorted pilot cases sampled with seed 20261215. The original seven confirmation rows remain unchanged in the main pass; parity is separate from inference.", "",
              "Driftbench agrees on 30/30 comparable verdicts (7/7 confirmation, 23/23 pilot). DeepEval agrees on 27/27 (4/4 confirmation, 23/23 pilot). Three original confirmation DeepEval answers are missing from CLI timeouts, so agreement is undefined there. All 60 API side verdicts are present. The small diagnostic finds no disagreement; it does not prove transport equivalence.", "",
              "Both adapters send their unchanged system/user strings to `POST /v1/messages`, model `claude-haiku-5-5`, version `2023-06-01`. The API requires an output ceiling: `max_tokens=32768`. Temperature, top_p, thinking, effort, tools, cache_control and beta overrides are omitted. CLI-internal defaults and wrapper behavior are not asserted identical to API defaults. No judge criterion, prompt renderer, parser, threshold, generator or original frozen setting changes.", "",
              "429 and 5xx responses retry the identical request body with backoff, jitter and Retry-After, at most eight HTTP attempts. Genuine timeouts retain the separately authorized single post-main retry. Successful fresh parity requests are reused when they resolve a timeout chain, preventing rebilling an existing answer; `api/retry/parity-reused.json` lists them. Pilot requests are forbidden in confirmation.", "",
              "## Calls and cost", "", "```json", json.dumps(evidence, indent=2), "```", "",
              "API cost is calculated from response usage at the [published rates](https://platform.claude.com/docs/en/about-claude/pricing): $0.10 input and $0.50 output per million tokens for prompts up to 100,000 tokens, fivefold above that. Cache categories use the policy's published rates if present. The total includes parity and conservative reservations for CLI attempts without billing data; it is not an exact invoice.", "",
              "## Reproduction", "", "Run `.venv/bin/python comparisons/deepeval/lead/power_score.py` for offline auditing/scoring. It rebuilds both verdicts and DeepEval request chains for all 1272 cases from recorded raw responses, with no network-backed recorder. Launch files prevent a second paid phase; durable reservations precede calls. CLI, parity, API main and timeout recovery ledgers remain separate.", ""]
    (ROOT / "REPORT.md").write_text("\n".join(lines))
    print(json.dumps({"before": pre, "after": post, "evidence": evidence, "outcome": score["outcome"], "holm": score["paired_p_holm"]}, indent=2))


if __name__ == "__main__":
    os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
    main()
