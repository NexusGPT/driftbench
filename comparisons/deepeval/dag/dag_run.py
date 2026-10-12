"""DeepEval's DAG metric (one binary judgement node on the relevancy question), with the claude command as its model.

Usage: python dag/dag_run.py MODEL [DATASET]     (MODEL: haiku | sonnet; DATASET: relevancy (default) | relevancy-hard)
Writes results/dag-MODEL.json. Recorded answers go to cassettes/MODEL-dag.json, so a rerun replays them at no cost.
Needs the deepeval package (pip install deepeval==4.2.8) and the claude command.
"""
import hashlib, json, os, subprocess, sys, tempfile, threading
from concurrent.futures import ThreadPoolExecutor
MODEL = sys.argv[1]
DATASET = sys.argv[2] if len(sys.argv) > 2 else "relevancy"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CAS = os.path.join(ROOT, "cassettes", MODEL + "-dag.json")
CASSETTE = json.load(open(CAS)) if os.path.exists(CAS) else {}
COST = [0.0]; NEW = {}; LOCK = threading.Lock()
def call(system, user):
    k = hashlib.sha256(json.dumps([MODEL, system, user]).encode()).hexdigest().translate(str.maketrans("0123456789", "abcdefghij"))
    with LOCK:
        if k in CASSETTE: return CASSETTE[k]["result"]
    args = ["claude", "-p", "--output-format", "json", "--model", MODEL, "--system-prompt", system, "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--no-session-persistence", "--max-turns", "1", "--max-budget-usd", "0.05"]
    for attempt in range(3):
        with tempfile.TemporaryDirectory() as cwd:
            r = subprocess.run(args, input=user, capture_output=True, text=True, cwd=cwd)
        if r.returncode == 0:
            j = json.loads(r.stdout); result = str(j.get("result", "")); cost = float(j.get("total_cost_usd", 0))
            with LOCK:
                COST[0] += cost; NEW[k] = {"result": result, "cost": cost}
            return result
    return ""
import deepeval
from deepeval.models.base_model import DeepEvalBaseLLM
from deepeval.metrics import DAGMetric
from deepeval.metrics.dag import DeepAcyclicGraph, BinaryJudgementNode, VerdictNode
from deepeval.test_case import LLMTestCase, SingleTurnParams
class M(DeepEvalBaseLLM):
    def __init__(self): super().__init__(model_name=MODEL)
    def load_model(self): return None
    def generate(self, prompt, schema=None):
        text = call("Answer with one JSON object and nothing else.", prompt)
        if schema is None: return text
        s = text.find("{"); e = text.rfind("}") + 1
        return schema.model_validate(json.loads(text[s:e]))
    async def a_generate(self, prompt, schema=None): return self.generate(prompt, schema)
    def get_model_name(self): return MODEL
dag = DeepAcyclicGraph(root_nodes=[BinaryJudgementNode(
    criteria="Does the reply answer the user's ask in this turn, in any words? It does not answer a different question, change the subject, or ignore the ask.",
    evaluation_params=[SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT],
    children=[VerdictNode(verdict=False, score=0), VerdictNode(verdict=True, score=10)])])
rows = json.load(open(os.path.join(ROOT, "datasets", DATASET + ".json")))
def one(r):
    m = DAGMetric(name="relevancy", dag=dag, model=M(), threshold=0.5, async_mode=False, include_reason=False)
    try:
        m.measure(LLMTestCase(input=r["ask"], actual_output=r["reply"]))
        return {"id": r["id"], "dag": "pass" if m.score >= 0.5 else "fail"}
    except Exception as e:
        return {"id": r["id"], "dag": "error", "err": str(e)[:80]}
with ThreadPoolExecutor(max_workers=10) as ex:
    out = list(ex.map(one, rows))
os.makedirs(os.path.join(ROOT, "results"), exist_ok=True)
json.dump({"model": MODEL, "cost_usd": round(COST[0], 4), "rows": out}, open(os.path.join(ROOT, "results", f"dag-{MODEL}" + ("" if DATASET == "relevancy" else "-" + DATASET) + ".json"), "w"), indent=1)
if NEW:
    CASSETTE.update(NEW); json.dump(CASSETTE, open(CAS, "w"), indent=0, sort_keys=True)
print("dag", MODEL, len(out), "errors", sum(1 for x in out if x["dag"] == "error"), "cost", round(COST[0], 4))
