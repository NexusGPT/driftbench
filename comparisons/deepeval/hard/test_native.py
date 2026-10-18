"""Checks the actual pinned metric pipeline with fabricated model responses."""
import importlib.util
import json
import unittest

from run import metrics


class StubRecorder:
    def __init__(self, answers):
        self.answers = iter(answers)
        self.inputs = []

    def call(self, system, prompt):
        self.inputs.append((system,prompt))
        return json.dumps(next(self.answers))


@unittest.skipUnless(importlib.util.find_spec("deepeval"), "optional pinned Python dependency")
class NativeTests(unittest.TestCase):
    def test_faithfulness_consumes_object_claims_and_truth_extraction(self):
        rec = StubRecorder([
            {"truths":["The plan is $45 monthly."]},
            {"claims":["The plan is $44 monthly."]},
            {"verdicts":[{"verdict":"no", "reason":"45, not 44"}]},
        ])
        case = {"turns":[{"role":"user", "content":"Price?"}, {"role":"assistant", "content":"$44 monthly."}], "contexts":["The plan is $45 monthly."]}
        result = metrics(rec)("faithfulness",case)
        self.assertFalse(result["prediction"])
        self.assertEqual(result["score"],0)
        self.assertEqual(len(rec.inputs),3)
        self.assertIn("DIRECTLY CONTRADICTS",rec.inputs[-1][1])
        self.assertIn("borderline",rec.inputs[-1][1])

    def test_hallucination_uses_native_higher_is_better_score(self):
        rec = StubRecorder([{"verdicts":[{"verdict":"yes", "reason":"agrees"}]}])
        case = {"turns":[{"role":"user", "content":"Price?"}, {"role":"assistant", "content":"$45 monthly."}], "contexts":["The plan is $45 monthly."]}
        result = metrics(rec)("hallucination",case)
        self.assertTrue(result["prediction"])
        self.assertEqual(result["score"],1)

    def test_partial_completion_default_threshold_is_not_strict(self):
        rec = StubRecorder([
            {"intentions":["price", "data", "billing date"]},
            {"verdict":"yes"}, {"verdict":"yes"},
            {"verdict":"no", "reason":"unanswered date"},
        ])
        case = {"turns":[{"role":"user", "content":"Price, data and date?"}, {"role":"assistant", "content":"$45 monthly, 60 GB. I will check the date."}]}
        result = metrics(rec)("conversation completeness",case)
        self.assertTrue(result["prediction"])
        self.assertAlmostEqual(result["score"],2/3)

    def test_task_receipt_enters_actual_native_tool_call_prompt(self):
        from receipts import augment
        case = augment({"turns":[{"role":"user","content":"Place order PLACE_SENTINEL."},
                                 {"role":"assistant","content":"PLACE_SENTINEL placed, reference REF_SENTINEL."}]})
        rec = StubRecorder([{"task":"Place order", "outcome":"Order placed, REF_SENTINEL"},
                            {"verdict":1,"reason":"receipt confirms result"}])
        result = metrics(rec)("task completion",case)
        self.assertTrue(result["prediction"])
        self.assertEqual(len(rec.inputs),2)
        self.assertIn("acme.task_receipt",rec.inputs[0][1])
        self.assertIn("PLACE_SENTINEL placed, reference REF_SENTINEL",rec.inputs[0][1])


if __name__ == "__main__":
    unittest.main()
