"""Offline checks of the lead harness. No model call, no fresh case read."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("lead_run", ROOT / "run.py")
lead = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lead)
import freeze_fresh  # noqa: E402


def row(truth, ours, theirs, name="knowledge retention"):
    return {"row": name, "truth": truth, "id": f"x{len(str(ours))}",
            "ours": {"prediction": ours}, "theirs": {"prediction": theirs}}


class Summary(unittest.TestCase):
    def test_counts_and_paired_test(self):
        rows = [row(True, True, False)] * 8 + [row(False, False, False)] * 10 + [row(True, None, True)]
        [s] = lead.summary(rows)
        self.assertEqual((s["n"], s["ours"], s["theirs"]), (19, 18, 11))
        self.assertEqual((s["ours_only_right"], s["theirs_only_right"]), (8, 1))
        self.assertAlmostEqual(s["paired_p"], 0.0390625)
        self.assertEqual(s["ours_unparsed"], 1)

    def test_unparsed_counts_wrong(self):
        [s] = lead.summary([row(False, None, False)])
        self.assertEqual((s["ours"], s["theirs"]), (0, 1))


class Freeze(unittest.TestCase):
    def test_changed_prompt_is_refused(self):
        prompts = {"a": {"system": "s", "user": "u"}}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "fresh-freeze.json"
            old = freeze_fresh.FREEZE
            freeze_fresh.FREEZE = path
            try:
                path.write_text(json.dumps({"state": freeze_fresh.state(prompts, {"knowledge": "default"})}))
                freeze_fresh.verify(prompts, {"knowledge": "default"})
                with self.assertRaises(ValueError):
                    freeze_fresh.verify({"a": {"system": "s", "user": "changed"}}, {"knowledge": "default"})
                with self.assertRaises(ValueError):
                    freeze_fresh.verify(prompts, {"knowledge": "response-relevance"})
            finally:
                freeze_fresh.FREEZE = old


if __name__ == "__main__":
    unittest.main()
