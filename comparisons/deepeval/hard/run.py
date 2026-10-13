"""Serial Haiku measurement through claude -p, with durable replay and spend.

Uses the pinned metric implementations, not hand-reimplemented prompt fragments.
Every call stores its complete input, raw response, actual model and USD cost.
Defaults to free replay. Fresh calls require --record and a spend cap.
"""
import argparse
from datetime import datetime, timedelta
import fcntl
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import subprocess
import time
from recordings import append, records, sanitize
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
CALLS = ROOT / "calls.jsonl"
SYS = "You answer with one JSON object and nothing else."
GEVAL_STEPS = [
    "Read the user ask in this turn.",
    "Check whether the reply answers what the user asked in this turn, in any words.",
    "Score 1 if the reply answers the ask; score 0 if it answers a different question, changes the subject, or ignores the ask.",
]


class StopRun(Exception):
    pass


def parse(text):
    decoder = json.JSONDecoder()
    for i, c in enumerate(text):
        if c in "{[":
            try:
                obj, _ = decoder.raw_decode(text[i:])
                return normalize_singletons(obj)
            except ValueError:
                continue
    raise ValueError("No JSON value in model response")


def normalize_singletons(obj):
    """Layout-only repair shared by every contestant; never repairs a decision.

    The role template's own example uses an object despite declaring a list.
    Our audit has an analogous list-of-checks contract, so apply the same rule.
    Raw responses retain the documented operator-identifier redaction.
    """
    if not isinstance(obj, dict):
        return obj
    shapes = {"verdicts": [{"index", "reason"}, {"verdict"}],
              "checks": [{"requirement", "evidence", "status"}]}
    for key, required_shapes in shapes.items():
        value = obj.get(key)
        if isinstance(value, dict) and any(required <= value.keys() for required in required_shapes):
            obj = {**obj, key: [value]}
    return obj


def call_key(model, system, user):
    return hashlib.sha256(json.dumps([model, system, user], ensure_ascii=False).encode()).hexdigest()


def wilson(k, n):
    if not n:
        return [0, 0]
    z = 1.96
    p, d = k / n, 1 + z*z/n
    c = (p + z*z/(2*n))/d
    h = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n))/d
    return [round(100*max(0, c-h), 2), round(100*min(1, c+h), 2)]


def paired_p(b, c):
    return min(1, 2*sum(math.comb(b+c, j) for j in range(min(b, c)+1))/2**(b+c)) if b+c else 1.0


class Recorder:
    def __init__(self, record=False, cap=0, total_cap=8, deadline=None, path=CALLS):
        self.path, self.record, self.cap, self.total_cap = path, record, cap, total_cap
        self.deadline = deadline
        self.fresh, self.replays, self.keys, self.context = [], 0, [], {}
        self.cache = {}
        self.records = {}
        self.prior_spend = 0.0
        if path.exists() or list(path.parent.glob("calls-[0-9][0-9][0-9].jsonl")):
            for r in records(path):
                self.prior_spend += r["charged_usd"]
                self.records[r["request_sha256"]] = r
                if not r.get("error"):
                    self.cache[r["request_sha256"]] = r

    @property
    def spent(self):
        return sum(r["charged_usd"] for r in self.fresh)

    def call(self, system, user):
        key = call_key("haiku", system, user)
        self.keys.append(key)
        if key in self.cache:
            self.replays += 1
            return self.cache[key]["result"]
        if not self.record:
            raise StopRun(f"Replay miss: {key}")
        # Reserve the entire per-invocation cap, including unreported failures.
        reserve = 0.05
        if self.spent + reserve > self.cap or self.prior_spend + self.spent + reserve > self.total_cap:
            raise StopRun("Spend cap reached")
        if self.deadline and datetime.now(ZoneInfo("Europe/Brussels")) >= self.deadline:
            raise StopRun("Local deadline reached")
        args = ["claude", "-p", "--output-format", "json", "--model", "haiku", "--system-prompt", system,
                "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--no-session-persistence",
                "--max-turns", "1", "--max-budget-usd", str(reserve)]
        cwd = ROOT / ".runtime"
        cwd.mkdir(exist_ok=True)
        row = {"request_sha256": key, "system": system, "user": user, "requested_model": "haiku",
               "timestamp": datetime.now().astimezone().isoformat(), **self.context}
        try:
            remaining = (self.deadline-datetime.now(ZoneInfo("Europe/Brussels"))).total_seconds() if self.deadline else 180
            proc = subprocess.run(args, input=user, text=True, capture_output=True, cwd=cwd, timeout=max(.01,min(180,remaining)))
            env = json.loads(proc.stdout)
            row.update(result=str(env.get("result", "")), envelope=env,
                       charged_usd=float(env["total_cost_usd"]))
            if proc.returncode or env.get("is_error"):
                row["error"] = f"Claude invocation failed: {env.get('subtype', proc.returncode)}"
        except Exception as exc:
            row.update(error=str(exc), result="", charged_usd=reserve, cost_is_reservation=True)
        row = sanitize(row)
        append(self.path, row)
        self.fresh.append(row)
        self.records[key] = row
        if row.get("error"):
            raise ValueError(row["error"])
        self.cache[key] = row
        return row["result"]

    def cost(self, keys):
        return sum(self.records[k]["charged_usd"] for k in set(keys) if k in self.records)


def metrics(recorder):
    from deepeval.models.base_model import DeepEvalBaseLLM
    from deepeval.metrics import (TurnRelevancyMetric, RoleAdherenceMetric, ConversationCompletenessMetric,
                                 TaskCompletionMetric, HallucinationMetric, FaithfulnessMetric,
                                 KnowledgeRetentionMetric, GEval, DAGMetric)
    from deepeval.metrics.dag import DeepAcyclicGraph, BinaryJudgementNode, VerdictNode
    from deepeval.test_case import LLMTestCase, ConversationalTestCase, Turn, SingleTurnParams, ToolCall

    class Model(DeepEvalBaseLLM):
        def __init__(self):
            super().__init__(model_name="haiku")

        def load_model(self):
            return None

        def generate(self, prompt, schema=None):
            answer = recorder.call(SYS, prompt)
            return schema.model_validate(parse(answer)) if schema else answer

        async def a_generate(self, prompt, schema=None):
            return self.generate(prompt, schema)

        def get_model_name(self):
            return "haiku"

    common = dict(model=Model(), include_reason=False, async_mode=False, eval_mode="llm")
    params = [SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT]

    def measure(name, case):
        conv = ConversationalTestCase(turns=[Turn(**m) for m in case["turns"]], chatbot_role=case.get("role"))
        single = LLMTestCase(input="\n".join(m["content"] for m in case["turns"] if m["role"] == "user"),
                             actual_output=case["turns"][-1]["content"],
                             context=case.get("contexts"), retrieval_context=case.get("contexts"),
                             tools_called=[ToolCall(**r) for r in case["tool_receipts"]] if case.get("tool_receipts") else None)
        if name == "turn relevancy": metric, tc = TurnRelevancyMetric(**common), conv
        elif name == "role adherence": metric, tc = RoleAdherenceMetric(**common), conv
        elif name == "conversation completeness": metric, tc = ConversationCompletenessMetric(**common), conv
        elif name == "task completion": metric, tc = TaskCompletionMetric(**common), single
        elif name == "hallucination": metric, tc = HallucinationMetric(**common), single
        elif name == "faithfulness": metric, tc = FaithfulnessMetric(**common), single
        elif name == "knowledge retention": metric, tc = KnowledgeRetentionMetric(**common), conv
        elif name == "G-Eval strict":
            kw = {k: v for k, v in common.items() if k not in ["include_reason", "eval_mode"]}
            metric, tc = GEval(name="relevancy", evaluation_params=params, evaluation_steps=GEVAL_STEPS,
                               strict_mode=True, **kw), single
        elif name == "DAG":
            graph = DeepAcyclicGraph(root_nodes=[BinaryJudgementNode(
                criteria="Does the reply answer the user's ask in this turn, in any words? It does not answer a different question, change the subject, or ignore the ask.",
                evaluation_params=params,
                children=[VerdictNode(verdict=False, score=0), VerdictNode(verdict=True, score=10)])])
            metric, tc = DAGMetric(name="relevancy", dag=graph, **common), single
        else:
            raise ValueError(name)
        metric.measure(tc, _show_indicator=False)
        return {"prediction": bool(metric.is_successful()), "score": metric.score}
    return measure


ROWS = {
    "relevancy": ["turn relevancy", "G-Eval strict", "DAG"],
    "role": ["role adherence"], "completeness": ["conversation completeness"],
    "task": ["task completion"], "grounding": ["hallucination", "faithfulness"],
    "knowledge": ["knowledge retention"],
}


def baseline(recorder, prompt):
    answer = parse(recorder.call(prompt["system"], prompt["user"]))
    if not isinstance(answer, dict):
        raise ValueError("Baseline response is not a JSON object")
    label = answer.get("outcome")
    return {"prediction": {"pass": True, "fail": False}.get(label), "answer": answer}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sets", default=",".join(ROWS))
    ap.add_argument("--variant", choices=["baseline", "audit"], default="baseline")
    ap.add_argument("--tag", default="baseline")
    ap.add_argument("--corpus", choices=["v1", "v2", "v3", "heldout"], default="v3")
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
    suffix = "" if args.corpus == "v3" else "-"+args.corpus
    if args.evidence == "receipt":
        if args.corpus == "v1" or args.sets != "task":
            raise ValueError("Receipt variant uses --sets task with corrected hard or heldout corpus")
        suffix = "-receipts"+suffix
    sets_file = ROOT / f"sets{suffix}.json"
    prompts_file = ROOT / f"baseline-prompts{suffix}.json"
    sets = json.loads(sets_file.read_text())
    prompts = json.loads(prompts_file.read_text())
    if args.corpus == "heldout":
        from freeze import verify
        verify(ROOT)
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
        target = ROOT / f"{args.tag}.json"

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
