"""Offline invariants. No model calls. python3 -m unittest discover -s this-dir."""
from datetime import datetime, timedelta
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

from audit import aggregate, prompt
from generate import build
from run import Recorder, ROOT, StopRun, call_key, normalize_singletons, paired_p, parse, wilson


class HardTests(unittest.TestCase):
    def setUp(self):
        (ROOT / ".runtime").mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / ".runtime")
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "calls.jsonl"

    def test_sets_are_frozen_balanced_counterfactuals(self):
        sets = json.loads((ROOT / "sets.json").read_text())
        self.assertEqual(build(), sets)
        for rows in sets.values():
            self.assertEqual(len(rows), 120)
            self.assertEqual(sum(r["truth"] for r in rows), 60)
            pairs = {}
            for row in rows: pairs.setdefault(row["pair"], []).append(row)
            self.assertEqual(len(pairs), 60)
            for pair in pairs.values():
                self.assertEqual({r["truth"] for r in pair}, {True, False})
                self.assertNotEqual(pair[0]["turns"][-1]["content"], pair[1]["turns"][-1]["content"])

    def test_truth_and_metadata_never_enter_audit(self):
        for name, cases in build().items():
            for case in cases:
                s, u = prompt(name, case)
                modified = {**case, "truth": not case["truth"], "id": "LEAK_SENTINEL", "pair": "SECRET_PAIR", "kind": "SECRET_KIND"}
                self.assertEqual((s, u), prompt(name, modified))
                self.assertNotIn("LEAK_SENTINEL", u)
                self.assertNotIn("knowledge", json.loads(u))

    def test_renderer_excludes_metadata(self):
        prompts = json.loads((ROOT / "baseline-prompts.json").read_text())
        for cases in build().values():
            for row in cases:
                self.assertNotIn(row["id"], prompts[row["id"]]["user"])
                self.assertNotIn('"truth"', prompts[row["id"]]["user"])

    def test_reasoning_cannot_override_ledger(self):
        answer = {"outcome": "fail", "reasoning": "Fail", "checks": [{"requirement": "price", "evidence": "$45", "status": "met"}]}
        self.assertTrue(aggregate(answer))
        answer["checks"].append({"requirement": "data", "evidence": "not stated", "status": "not_met"})
        answer["outcome"] = "pass"
        self.assertFalse(aggregate(answer))

    def test_invalid_or_empty_ledger_does_not_pass(self):
        for a in [{}, [], {"checks": []}, {"checks": [{"status": "met"}]},
                  {"checks": [{"requirement": "price", "evidence": "$45", "status": "pass"}]}]:
            with self.assertRaises(ValueError): aggregate(a)

    def test_parser_nested_braces_and_fences(self):
        self.assertEqual(parse('```json\n{"reason":"brace } inside", "checks": []}\n```'), {"reason": "brace } inside", "checks": []})
        with self.assertRaises(ValueError): parse("not JSON")

    def test_shared_singleton_normalization_is_layout_only(self):
        obj = {"verdicts": {"index": 1, "reason": "out of role"}, "outcome": "fail"}
        normalized = normalize_singletons(obj)
        self.assertEqual(normalized["verdicts"], [obj["verdicts"]])
        self.assertEqual(normalized["outcome"], "fail")
        self.assertIsInstance(obj["verdicts"], dict)
        self.assertEqual(normalize_singletons({"verdicts": {"unexpected": "value"}}), {"verdicts": {"unexpected": "value"}})
        native = {"verdicts": {"verdict": "no", "reason": "contradiction"}}
        self.assertEqual(normalize_singletons(native)["verdicts"], [native["verdicts"]])
        audit = {"checks": {"requirement": "price", "evidence": "$45", "status": "not_met"}}
        self.assertFalse(aggregate(normalize_singletons(audit)))

    def test_corpus_correction_changes_only_role_user_contexts(self):
        original = json.loads((ROOT / "sets-v1.json").read_text())
        corrected = json.loads((ROOT / "sets-v2.json").read_text())
        changes = 0
        for name, cases in corrected.items():
            for old, new in zip(original[name], cases):
                self.assertEqual(old["id"], new["id"])
                self.assertEqual(old["truth"], new["truth"])
                if old != new:
                    self.assertEqual(name, "role")
                    self.assertEqual(old["turns"][1], new["turns"][1])
                    self.assertNotEqual(old["turns"][0], new["turns"][0])
                    changes += 1
        self.assertEqual(changes, 60)

    def test_source_clarification_preserves_labels_turns_and_other_sets(self):
        for old_file,seed,pairs in [("sets-v2.json",20261012,5),("sets-heldout-v2.json",20261019,3)]:
            old=json.loads((ROOT/old_file).read_text())
            new=build(seed,pairs)
            for name,cases in new.items():
                for before,after in zip(old[name],cases):
                    self.assertEqual({k:v for k,v in before.items() if k!="contexts"},
                                     {k:v for k,v in after.items() if k!="contexts"})
                    if name=="grounding":
                        self.assertEqual(after["contexts"][5],before["contexts"][5].replace("The lead reference","The user's lead reference"))
                        for i in range(5): self.assertEqual(before["contexts"][i],after["contexts"][i])
                        if after["kind"]=="negation":
                            self.assertTrue(after["contexts"][-1].endswith("includes no discount and no router."))
                        else: self.assertEqual(before["contexts"][-1],after["contexts"][-1])
                    else: self.assertEqual(before,after)

    def test_heldout_is_fresh_balanced_and_covers_all_families(self):
        hard = build()
        heldout = build(20261019,3)
        self.assertEqual(heldout, json.loads((ROOT / "sets-heldout.json").read_text()))
        for name, cases in heldout.items():
            self.assertEqual(len(cases),72)
            self.assertEqual(sum(r["truth"] for r in cases),36)
            self.assertEqual({r["kind"] for r in cases},{r["kind"] for r in hard[name]})
            hard_inputs = {json.dumps({k:v for k,v in r.items() if k in ['turns','contexts','role']},sort_keys=True) for r in hard[name]}
            for r in cases:
                body = json.dumps({k:v for k,v in r.items() if k in ['turns','contexts','role']},sort_keys=True)
                self.assertNotIn(body,hard_inputs)

    def test_replay_with_zero_budget_and_no_process(self):
        key = call_key("haiku", "system", "user")
        self.path.write_text(json.dumps({"request_sha256": key, "result": "answer", "charged_usd": .01})+"\n")
        rec = Recorder(path=self.path)
        with patch("run.subprocess.run") as process:
            self.assertEqual(rec.call("system", "user"), "answer")
            process.assert_not_called()
        self.assertEqual(rec.spent, 0)
        self.assertEqual(rec.replays, 1)
        self.assertEqual(rec.cost([key, key]), .01)

    def test_replay_miss_stops_without_call(self):
        rec = Recorder(path=self.path)
        with patch("run.subprocess.run") as process:
            with self.assertRaises(StopRun): rec.call("s", "u")
            process.assert_not_called()

    def test_per_run_and_cumulative_cap_reserve_whole_call(self):
        rec = Recorder(record=True, cap=.049, path=self.path)
        with patch("run.subprocess.run") as process:
            with self.assertRaises(StopRun): rec.call("s", "u")
            process.assert_not_called()
        self.path.write_text(json.dumps({"request_sha256":"old", "charged_usd":7.96, "error":"timeout"})+"\n")
        rec = Recorder(record=True, cap=8, path=self.path)
        with patch("run.subprocess.run") as process:
            with self.assertRaises(StopRun): rec.call("s", "u")
            process.assert_not_called()

    def test_deadline_stops_before_call(self):
        past = datetime.now(ZoneInfo("Europe/Brussels"))-timedelta(seconds=1)
        rec = Recorder(record=True, cap=1, deadline=past, path=self.path)
        with patch("run.subprocess.run") as process:
            with self.assertRaises(StopRun): rec.call("s", "u")
            process.assert_not_called()

    def test_paid_response_persists_and_is_reused(self):
        rec = Recorder(record=True, cap=.1, path=self.path)
        envelope = {"result": '{"outcome":"pass"}', "total_cost_usd":.001, "modelUsage":{"claude-haiku-4-5":{}}}
        completed = subprocess.CompletedProcess([], 0, json.dumps(envelope), "")
        with patch("run.subprocess.run", return_value=completed) as process:
            rec.call("s", "u"); rec.call("s", "u")
            self.assertEqual(process.call_count, 1)
            args = process.call_args.args[0]
            self.assertIn("--max-budget-usd", args)
            self.assertEqual(args[args.index("--model")+1], "haiku")
        row = json.loads(self.path.read_text())
        self.assertEqual(row["envelope"]["modelUsage"], envelope["modelUsage"])
        self.assertEqual(row["system"], "s")
        self.assertEqual(row["user"], "u")
        self.assertEqual(rec.spent, .001)

    def test_unreported_failure_reserves_cost_and_never_caches_success(self):
        rec = Recorder(record=True, cap=.1, path=self.path)
        with patch("run.subprocess.run", side_effect=subprocess.TimeoutExpired("claude",180)):
            with self.assertRaises(ValueError): rec.call("s", "u")
        row = json.loads(self.path.read_text())
        self.assertEqual(row["charged_usd"], .05)
        self.assertTrue(row["cost_is_reservation"])
        self.assertEqual(rec.cache, {})
        self.assertEqual(rec.cost(rec.keys), .05)

    def test_chunk_rotation_is_lossless_and_replay_reads_every_chunk(self):
        from recordings import append, records
        row1 = {"request_sha256": call_key("haiku", "s", "u"), "result": "first", "charged_usd": .01}
        row2 = {"request_sha256": call_key("haiku", "s", "v"), "result": "second", "charged_usd": .02}
        with patch("recordings.MAX_BYTES", 250):
            append(self.path, row1)
            original = self.path.read_bytes()
            append(self.path, row2)
        self.assertEqual((self.path.parent/"calls-000.jsonl").read_bytes(), original)
        self.assertEqual(list(records(self.path)), [row1, row2])
        recorder = Recorder(path=self.path)
        self.assertEqual(recorder.call("s", "u"), "first")
        self.assertEqual(recorder.call("s", "v"), "second")
        self.assertAlmostEqual(recorder.prior_spend, .03)

    def test_redaction_preserves_private_original_and_public_decisions(self):
        from recordings import sanitize
        private = self.path.parent/"private"
        private.mkdir()
        value = "operator@example.invalid"
        (private/"operator-email.txt").write_text(value)
        row = {"system":"s", "user":"u", "requested_model":"haiku", "request_sha256":call_key("haiku","s","u"),
               "result":json.dumps({"checks":[{"requirement":"name", "evidence":value, "status":"met"}]}),
               "charged_usd":.01}
        clean = sanitize(row, private)
        self.assertNotIn(value, json.dumps(clean))
        self.assertIn("[redacted-operator-email]", clean["result"])
        self.assertEqual(json.loads((private/"future-originals.jsonl").read_text()),row)
        self.assertEqual(clean["request_sha256"],row["request_sha256"])
        self.assertEqual(clean["charged_usd"],row["charged_usd"])
        self.assertEqual(aggregate(parse(clean["result"])),aggregate(parse(row["result"])))
        with self.assertRaisesRegex(ValueError,"model input"):
            sanitize({**row,"user":value},private)

    def test_interval_and_paired_test(self):
        self.assertEqual(wilson(120,120), [96.9,100])
        self.assertEqual(paired_p(0,0),1)
        self.assertEqual(paired_p(5,0),.0625)
        self.assertLess(paired_p(10,0),.05)

    def test_freeze_rejects_changed_candidate_or_corpus(self):
        from freeze import FILES, hashes, verify
        root = Path(self.temp.name)
        for name in FILES: (root/name).write_text(name)
        (root/"candidate-freeze.json").write_text(json.dumps({"sha256":hashes(root)}))
        verify(root)
        (root/"audit.py").write_text("new candidate")
        with self.assertRaises(ValueError): verify(root)

    def test_receipt_matches_conversation_without_reading_label(self):
        from receipts import augment
        for suffix in ["", "-heldout"]:
            original = json.loads((ROOT/f"sets{suffix}.json").read_text())["task"]
            extended = json.loads((ROOT/f"sets-receipts{suffix}.json").read_text())["task"]
            for old,new in zip(original,extended):
                self.assertEqual(augment(old),new)
                for key,value in old.items(): self.assertEqual(new[key],value)
                changed = {**old,"truth":not old["truth"],"id":"LABEL_SENTINEL"}
                self.assertEqual(augment(changed)["tool_receipts"],new["tool_receipts"])
                self.assertEqual(new["tool_receipts"][0]["output"]["result"],old["turns"][-1]["content"])
                self.assertNotIn("LABEL_SENTINEL",prompt("task",augment(changed))[1])

    def test_freeze_rejects_selection_after_heldout_or_stale_selection(self):
        from freeze import FILES, freeze, hashes
        root = Path(self.temp.name)
        for name in FILES: (root/name).write_text(name)
        current = hashes(root)
        (root/"audit-v3.json").write_text(json.dumps({"procedure_sha256":current['audit.py'],"sets_sha256":current['sets.json']}))
        (root/"calls.jsonl").write_text(json.dumps({"run":"baseline-heldout"})+"\n")
        with patch("score.tally"):
            with self.assertRaisesRegex(ValueError,"Held-out"): freeze(root)
            (root/"audit.py").write_text("changed")
            with self.assertRaisesRegex(ValueError,"Selection"): freeze(root)

    def test_recording_metadata_migration_preserves_raw_content(self):
        from migrate import migrate
        root = Path(self.temp.name)
        raw = {"key":"digest", "system":"SYS", "user":"USER", "result":'{"outcome":"fail","key":"raw model field"}',
               "envelope":{"result":"RAW", "total_cost_usd":.001}, "charged_usd":.001}
        self.path.write_text(json.dumps(raw)+"\n")
        result = {"rows":[{"ours":{"keys":["digest"],"answer":{"key":"untouched answer field"}},"theirs":{"keys":[]}}]}
        (root/"result.json").write_text(json.dumps(result))
        migrate(root)
        stored = json.loads(self.path.read_text())
        self.assertEqual(stored,{k:v for k,v in raw.items() if k!="key"}|{"request_sha256":"digest"})
        changed = json.loads((root/"result.json").read_text())["rows"][0]
        self.assertEqual(changed["ours"]["request_sha256s"],["digest"])
        self.assertEqual(changed["ours"]["answer"],result["rows"][0]["ours"]["answer"])
        self.assertEqual(migrate(root),[])


class PooledReceiptTests(unittest.TestCase):
    def test_partial_receipts_compare_only_common_cases_without_changing_sources(self):
        import pool
        import tempfile
        runtime = ROOT / ".runtime"
        runtime.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=runtime) as directory:
            root = Path(directory)
            (root / "additional").mkdir()
            def row(identifier, truth):
                side = {"prediction": truth, "request_sha256s": [identifier], "cost_usd": .001, "score": int(truth)}
                return {"row": "task completion", "set": "task", "id": identifier,
                        "truth": truth, "ours": side, "theirs": side}
            original = {"rows": [row("old-a", True), row("old-b", False)]}
            baseline = {"rows": [row("new-a", True), row("new-b", False)]}
            candidate = {"rows": [row("new-a", True)], "stopped": "Local deadline reached"}
            for name in ["baseline", "audit"]:
                (root / f"{name}-task-receipts-heldout.json").write_text(json.dumps(original))
            (root / "additional/baseline-task-receipts.json").write_text(json.dumps(baseline))
            (root / "additional/audit-task-receipts.json").write_text(json.dumps(candidate))
            sources = {p: p.read_bytes() for p in root.rglob("*.json")}
            with patch("pool.ROOT", root):
                for variant in ["baseline", "audit"]:
                    score = pool.pool(variant, True)[0]
                    self.assertEqual(score["n"], 3)
                    self.assertEqual(score["ours"], 3)
                    self.assertEqual(score["ours_distinct_inputs"], 3)
                    result = json.loads((root / f"additional/pooled-{variant}-task-receipts.json").read_text())
                    self.assertTrue(result["matched_case_subset"])
                    self.assertEqual([r["id"] for r in result["rows"]],
                                     ["seed20261019/old-a", "seed20261019/old-b", "seed20261020/new-a"])
            self.assertTrue(all(path.read_bytes() == content for path, content in sources.items()))


if __name__ == "__main__":
    unittest.main()
