"""Recorder tests use recorded fixtures, not a replacement native evaluator."""
import unittest
from native import summarize


class RecorderTests(unittest.TestCase):
    def test_full_score_and_scope_subgroups(self):
        cases = [
            {"id": "p", "kind": "names", "truth": True, "person": True},
            {"id": "a", "kind": "homes", "truth": True, "address": True},
            {"id": "i", "kind": "email", "truth": True, "identifier": True, "identifierType": "email"},
            {"id": "n", "kind": "email", "truth": False},
        ]
        results = [{"id": c["id"], "prediction": c["id"] == "i"} for c in cases]
        summary = summarize(cases, results)
        self.assertEqual(summary["full_pii"]["correct"], 2)
        self.assertEqual(summary["full_pii"]["false_negative"], 2)
        self.assertEqual(summary["positive_subgroups"]["person"]["false_negative"], 1)
        self.assertEqual(summary["positive_subgroups"]["address"]["false_negative"], 1)
        self.assertEqual(summary["identifier_types"]["email"]["correct"], 1)

    def test_missing_verdict_is_not_a_negative(self):
        cases = [{"id": "n", "kind": "blank", "truth": False}]
        summary = summarize(cases, [{"id": "n", "prediction": None}])
        self.assertEqual(summary["full_pii"]["total"], 1)
        self.assertEqual(summary["full_pii"]["processed"], 0)
        self.assertEqual(summary["full_pii"]["correct"], 0)
        self.assertEqual(summary["full_pii"]["true_negative"], 0)


if __name__ == "__main__":
    unittest.main()
