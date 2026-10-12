"""Free scoring and loss audit of complete recordings. No model dependency."""
import argparse
import collections
import json
from pathlib import Path

from run import CALLS, ROOT, ROWS, paired_p, wilson


def tally(recording, require_complete=True):
    grouped = collections.defaultdict(list)
    for r in recording["rows"]:
        grouped[r["row"]].append(r)
    expected = {r for names in ROWS.values() for r in names}
    if require_complete and set(grouped) != expected:
        raise ValueError("Missing comparison rows")
    summaries = []
    for name, cases in grouped.items():
        ids = [r["id"] for r in cases]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate case ID in row")
        expected_n = recording.get("expected_cases", {}).get(cases[0]["set"],120)
        if require_complete and len(cases) != expected_n:
            raise ValueError(f"Incomplete {name}: {len(cases)}/{expected_n}")
        n = len(cases)
        ours = [r["ours"]["prediction"] is r["truth"] for r in cases]
        theirs = [r["theirs"]["prediction"] is r["truth"] for r in cases]
        b = sum(o and not t for o, t in zip(ours,theirs))
        c = sum(t and not o for o, t in zip(ours,theirs))
        ko, kt = sum(ours), sum(theirs)
        # The table reports observed ordering, with inference explicitly separate.
        result = "ahead" if ko > kt else "behind" if ko < kt else "equal"
        summaries.append({"row":name, "n":n, "ours":ko, "theirs":kt,
                          "ours_ci":wilson(ko,n), "theirs_ci":wilson(kt,n),
                          "ours_only_right":b, "theirs_only_right":c,
                          "paired_p":paired_p(b,c), "outcome":result,
                          "ours_unparsed":sum(r["ours"]["prediction"] is None for r in cases),
                          "theirs_unparsed":sum(r["theirs"]["prediction"] is None for r in cases),
                          "cost_usd":sum(r["ours"]["cost_usd"]+r["theirs"]["cost_usd"] for r in cases),
                          "strict_theirs":sum(r["theirs"]["prediction"] is not None and
                                               ((r["theirs"].get("score")==1) is r["truth"]) for r in cases)})
    return summaries


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("recording", type=Path)
    ap.add_argument("--partial", action="store_true")
    ap.add_argument("--output", type=Path)
    args = ap.parse_args()
    recording = json.loads(args.recording.read_text())
    scores = tally(recording, not args.partial)
    print("| Row | n | Ours (95% CI) | Theirs (95% CI) | Observed result | Paired p | Cost USD |")
    print("|---|---|---|---|---|---|---|")
    for r in scores:
        print(f"| {r['row']} | {r['n']} | {r['ours']}/{r['n']} ({r['ours_ci'][0]} to {r['ours_ci'][1]}%) | {r['theirs']}/{r['n']} ({r['theirs_ci'][0]} to {r['theirs_ci'][1]}%) | {r['outcome']} | {r['paired_p']:.6g} | {r['cost_usd']:.6f} |")
    if args.output:
        args.output.write_text(json.dumps(scores, indent=2)+"\n")
    calls = {r["key"]: r for r in map(json.loads, CALLS.read_text().splitlines())}
    audit = [f"# {recording['variant']} loss audit", "", "Raw inputs and answers are preserved in calls.jsonl.", ""]
    for r in recording["rows"]:
        if r["ours"]["prediction"] is not r["truth"]:
            audit.extend([f"## {r['row']}: {r['id']}", "", f"Construction truth: {r['truth']}", ""])
            for side in ["ours", "theirs"]:
                audit.append(f"### {side}")
                for key in r[side]["keys"]:
                    audit.extend(["", f"Call `{key}`", "", "```json", calls[key]["result"], "```"])
            audit.append("")
    (ROOT / f"losses-{args.recording.stem}.md").write_text("\n".join(audit)+"\n")


if __name__ == "__main__":
    main()
