"""DeepEval's ToolCorrectnessMetric on the generated tool-call cases, in default, parameter and exact modes.

Deterministic: the model is a stub that is never called. Needs the deepeval package (pip install deepeval==4.2.8).
Usage, from comparisons/deepeval: OPENAI_API_KEY= python tools/tools_deepeval.py
Writes results/tools-deepeval.json.
"""
import json, os
from deepeval.metrics import ToolCorrectnessMetric
from deepeval.test_case import LLMTestCase, ToolCall, ToolCallParams
from deepeval.models.base_model import DeepEvalBaseLLM
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
class NoModel(DeepEvalBaseLLM):
    def __init__(self): super().__init__(model_name="none")
    def load_model(self): return None
    def generate(self, prompt, schema=None): raise RuntimeError("deterministic: the model must not be called")
    async def a_generate(self, prompt, schema=None): raise RuntimeError("deterministic: the model must not be called")
    def get_model_name(self): return "none"
exp = [ToolCall(name="coverage.check", input_parameters={"address": "14 Harbor Road, Acmeville"}), ToolCall(name="catalog.search", input_parameters={"category": "home", "address_id": "addr-101"})]
rows = json.load(open(os.path.join(ROOT, "datasets", "tools.json")))
res = {}
for r in rows:
    calls = [ToolCall(name=c["label"], input_parameters=c["input"]) for c in r["calls"]]
    tc = LLMTestCase(input="order", actual_output="x", tools_called=calls, expected_tools=exp)
    d = {"id": r["id"], "label": r["label"], "kind": r["kind"]}
    for name, kw, ep in [("default", {}, []), ("params", {}, [ToolCallParams.INPUT_PARAMETERS]), ("exact_params", {"should_exact_match": True}, [ToolCallParams.INPUT_PARAMETERS])]:
        m = ToolCorrectnessMetric(model=NoModel(), evaluation_params=ep, include_reason=False, async_mode=False, **kw)
        m.measure(tc); d[name] = "pass" if m.score >= 0.5 else "fail"
    res[r["id"]] = d
os.makedirs(os.path.join(ROOT, "results"), exist_ok=True)
json.dump(res, open(os.path.join(ROOT, "results", "tools-deepeval.json"), "w"), indent=1)
print("tools deepeval", len(res))
