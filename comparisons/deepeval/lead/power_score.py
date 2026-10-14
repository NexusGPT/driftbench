"""Audit and score the powered confirmation without model calls; publish its chart input."""
import json
from pathlib import Path

import power_run as power
from power_retry import available_summary, timeout

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
    original = list(lead.records(ROOT / "calls.jsonl"))
    retries = list(lead.records(ROOT / "retry" / "calls.jsonl"))
    old = {r["request_sha256"]: r for r in original}
    new = {r["request_sha256"]: r for r in retries}
    if len(old) != len(original) or len(new) != len(retries):
        raise ValueError("Duplicate paid request within a pass")
    if any(not timeout(old[k]) for k in old.keys() & new.keys()):
        raise ValueError("Retried a non-timeout request")
    prior = set(json.loads((ROOT / "prior-request-hashes.json").read_text()))
    if prior & (old.keys() | new.keys()):
        raise ValueError("Historical request re-billed")
    for row in original + retries:
        if lead.call_key("haiku", row["system"], row["user"]) != row["request_sha256"]:
            raise ValueError("Request hash mismatch")
    models = {k for row in original + retries for k in row.get("envelope", {}).get("modelUsage", {})}
    if models != {"claude-haiku-5-5"}:
        raise ValueError(f"Unexpected model set: {models}")
    combined = old | new
    for row in after["rows"]:
        for side in ["ours", "theirs"]:
            if not row[side]["request_sha256s"] or any(k not in combined for k in row[side]["request_sha256s"]):
                raise ValueError("Result references an absent recording")
    pause = main.get("owner_pause", {})
    total = sum(r["charged_usd"] for r in original + retries) + pause.get("cost_reservation_usd", 0)
    if total > power.CAP:
        raise ValueError("Spend cap exceeded")
    return {"main_calls": len(original), "retry_calls": len(retries),
            "retried_timeout_requests": len(old.keys() & new.keys()),
            "newly_reached_retry_stages": len(new.keys() - old.keys()),
            "historical_calls": 0, "duplicate_completed_recordings_per_pass": 0, "models": sorted(models),
            "owner_interrupted_attempts": pause.get("interrupted_requests", 0),
            "owner_interrupted_cost_reservation_usd": pause.get("cost_reservation_usd", 0),
            "main_cost_usd": sum(r["charged_usd"] for r in original) + pause.get("cost_reservation_usd", 0),
            "retry_cost_usd": sum(r["charged_usd"] for r in retries),
            "total_cost_or_reservation_usd": total,
            "unreported_cost_reservation_usd": sum(r["charged_usd"] for r in original + retries if r.get("cost_is_reservation")) + pause.get("cost_reservation_usd", 0)}


def main():
    frozen, cases, _ = power.verify()
    before = json.loads((ROOT / "results.json").read_text())
    after = json.loads((ROOT / "retry-results.json").read_text())
    if not after.get("retry_complete"):
        raise ValueError("Retry pass incomplete")
    evidence = audit(before, after, cases)
    pre, post = available_summary(before["rows"]), available_summary(after["rows"])
    scores_path = power.ROOT / "fresh-scores.json"
    scores = json.loads(scores_path.read_text())
    paired = post["paired"]
    n = paired["n"]
    if not n:
        raise ValueError("No complete paired cases")
    score = {"row": "knowledge retention", "n": n, "ours": paired["ours"], "theirs": paired["theirs"],
             "ours_ci": lead.wilson(paired["ours"], n), "theirs_ci": lead.wilson(paired["theirs"], n),
             "ours_only_right": paired["ours_only_right"], "theirs_only_right": paired["theirs_only_right"],
             "paired_p": paired["paired_p"], "setting": "default", "run": "power/retry-results.json",
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
              "- Both passes use concurrency 3. Valid answers and non-timeout errors never retry. An authorized successful retry can enable previously unreached downstream stages; each runs once. A second timeout remains missing.",
              "- The owner separately paused the main pass for host saturation. Completed cases and all recorded stages are retained. Three canceled in-flight requests restart as unfinished work only after the owner resumes; they are not classified as timeouts and retain a $0.15 combined cost reservation.",
              "- Both sides use the recorded model `claude-haiku-5-5`; DeepEval stays pinned to 4.2.8 and uses its unchanged metric implementation.", "",
              "## Calls and cost", "", "```json", json.dumps(evidence, indent=2), "```", "",
              "The cost total includes full per-call reservations where a timed-out subprocess did not report actual billing. It is a conservative recorded cost, not an exact invoice.", "",
              "## Reproduction", "", "Run `power_score.py` for offline auditing/scoring. `power_run.py replay` replays the original main pass with no fresh calls. The main-run and retry launch files prevent a second paid launch; reservations precede calls. Request hashes, raw outputs, costs and chains are committed in separate main and retry ledgers.", ""]
    (ROOT / "REPORT.md").write_text("\n".join(lines))
    print(json.dumps({"before": pre, "after": post, "evidence": evidence, "outcome": score["outcome"], "holm": score["paired_p_holm"]}, indent=2))


if __name__ == "__main__":
    main()
