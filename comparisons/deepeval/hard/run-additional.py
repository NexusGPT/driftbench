"""Additional frozen held-out seed; original measurement functions unchanged."""
from run import *
def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sets", default="task,grounding")
    ap.add_argument("--variant", choices=["baseline", "audit"], default="baseline")
    ap.add_argument("--tag", default="baseline")
    ap.add_argument("--corpus", choices=["additional"], default="additional")
    ap.add_argument("--evidence", choices=["conversation", "receipt"], default="conversation")
    ap.add_argument("--record", action="store_true")
    ap.add_argument("--cap-usd", type=float, default=0)
    ap.add_argument("--ledger", type=Path)
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()
    if importlib.metadata.version("deepeval") != "4.2.8":
        raise RuntimeError("Requires deepeval==4.2.8")
    now = datetime.now(ZoneInfo("Europe/Brussels"))
    runtime = ROOT / ".runtime"
    runtime.mkdir(exist_ok=True)
    deadline_file = runtime / "deadline.txt"
    if deadline_file.exists():
        deadline = datetime.fromisoformat(deadline_file.read_text().strip())
    else:
        deadline = now.replace(hour=7, minute=0, second=0, microsecond=0)
        if deadline <= now: deadline += timedelta(days=1)
        deadline_file.write_text(deadline.isoformat()+"\n")
    suffix = "-receipts" if args.evidence == "receipt" else ""
    if args.evidence == "receipt" and args.sets != "task":
        raise ValueError("Receipts require task only")
    sets_file = ROOT / "additional" / f"sets{suffix}.json"
    prompts_file = ROOT / "additional" / f"baseline-prompts{suffix}.json"
    sets = json.loads(sets_file.read_text())
    prompts = json.loads(prompts_file.read_text())
    from freeze import verify
    verify(ROOT)
    manifest = json.loads((ROOT / "additional" / "manifest.json").read_text())
    for name, digest in manifest["sha256"].items():
        if hashlib.sha256((ROOT/name).read_bytes()).hexdigest() != digest:
            raise ValueError("Additional frozen source or labels changed")
    # A process-wide lock keeps all metric stages and runs at concurrency one.
    with (ROOT / ".run.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        from migrate import migrate
        migrate(ROOT)
        rec = Recorder(args.record, args.cap_usd, deadline=deadline)
        competitor = metrics(rec)
        output = {"variant": args.variant, "model": "haiku", "package": "deepeval==4.2.8",
                  "corpus": args.corpus, "sets_sha256": hashlib.sha256(sets_file.read_bytes()).hexdigest(),
                  "evidence": args.evidence,
                  "expected_cases": {s: len(rows) for s, rows in sets.items()},
                  "procedure_sha256": hashlib.sha256((ROOT / "audit.py").read_bytes()).hexdigest() if args.variant == "audit" else None,
                  "deadline": deadline.isoformat(), "rows": []}
        target = ROOT / "additional" / f"{args.tag}.json"

        def save():
            output.update(fresh_calls=len(rec.fresh), fresh_usd=rec.spent, replays=rec.replays)
            temporary = target.with_suffix(".tmp")
            temporary.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
            temporary.replace(target)

        try:
            for set_name in args.sets.split(","):
                for case in sets[set_name][:args.limit]:
                    rec.context = {"run": args.tag, "set": set_name, "case": case["id"], "side": args.variant}
                    start = len(rec.keys)
                    try:
                        if args.variant == "audit":
                            from audit import audit
                            ours = audit(rec, set_name, case)
                        else:
                            ours = baseline(rec, prompts[case["id"]])
                    except ValueError as exc:
                        ours = {"prediction": None, "error": str(exc)}
                    ours["request_sha256s"] = rec.keys[start:]
                    ours["cost_usd"] = rec.cost(ours["request_sha256s"])
                    for name in ROWS[set_name]:
                        rec.context["side"] = name
                        start = len(rec.keys)
                        try:
                            theirs = competitor(name, case)
                        except ValueError as exc:
                            theirs = {"prediction": None, "error": str(exc)}
                        theirs["request_sha256s"] = rec.keys[start:]
                        theirs["cost_usd"] = rec.cost(theirs["request_sha256s"])
                        output["rows"].append({"row": name, "set": set_name, "id": case["id"],
                                               "truth": case["truth"], "ours": ours, "theirs": theirs})
                        save()
                    print(f"{args.tag}: {set_name} {case['id']}; rows {len(output['rows'])}; fresh ${rec.spent:.6f}", flush=True)
        except StopRun as exc:
            output["stopped"] = str(exc)
            print(str(exc), flush=True)
        finally:
            save()
            if args.ledger:
                with args.ledger.open("a") as ledger:
                    ledger.write(f"| {datetime.now().astimezone().isoformat()} | DeepEval | {args.tag} ({args.sets}) | {len(rec.fresh)} | {rec.spent:.8f} | {target.name} |\n")
        if output.get("stopped"):
            raise SystemExit(2)


if __name__ == "__main__":
    main()
