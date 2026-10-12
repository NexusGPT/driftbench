"""Run our judged criteria and DeepEval's prompts on the generated sets, with a cassette.

Usage: python judge/run.py MODEL SETS TAG
  MODEL  haiku | sonnet (the claude command's model alias)
  SETS   comma list, e.g. relevancy,role,knowledge2 (or "all")
  TAG    result file suffix: results/<MODEL>-<TAG>.json

Every model answer is recorded in cassettes/<MODEL>.json, keyed by a hash of the model, system prompt and user prompt.
A later run replays the recorded answers at no cost; a new prompt is called and recorded.
Needs: the claude command on the path, judge/ours-prompts.json (made by judge/render.mts), and the deepeval package
(pip install deepeval==4.2.8) for DeepEval's prompt templates.
"""
import hashlib, json, os, subprocess, sys, tempfile, threading, time
from concurrent.futures import ThreadPoolExecutor, as_completed
import deepeval
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODEL = sys.argv[1]; SETS = sys.argv[2]; TAG = sys.argv[3]
CAP = float(os.environ.get("SPEND_CAP_USD", "3.0"))
DATA = os.path.join(ROOT, "datasets"); RES = os.path.join(ROOT, "results"); CAS = os.path.join(ROOT, "cassettes", MODEL + ".json")
M = os.path.join(os.path.dirname(deepeval.__file__), "metrics") + os.sep
LOCK = threading.Lock(); COST = [0.0]; CALLS = [0]; FAILS = [0]; REPLAYS = [0]; NEW = {}
CASSETTE = json.load(open(CAS)) if os.path.exists(CAS) else {}
class Cap(Exception): pass
def key(system, user): return hashlib.sha256(json.dumps([MODEL, system, user]).encode()).hexdigest().translate(str.maketrans("0123456789", "abcdefghij"))
def call(system, user):
    k = key(system, user)
    with LOCK:
        if k in CASSETTE:
            REPLAYS[0] += 1
            return CASSETTE[k]["result"]
        if COST[0] >= CAP: raise Cap("spend cap reached")
    for attempt in range(3):
        with tempfile.TemporaryDirectory() as cwd:
            args = ["claude", "-p", "--output-format", "json", "--model", MODEL, "--system-prompt", system, "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--no-session-persistence", "--max-turns", "1", "--max-budget-usd", "0.05"]
            r = subprocess.run(args, input=user, capture_output=True, text=True, cwd=cwd)
        if r.returncode == 0:
            try:
                j = json.loads(r.stdout)
            except Exception:
                continue
            result = str(j.get("result", "")); cost = float(j.get("total_cost_usd", 0))
            with LOCK:
                COST[0] += cost; CALLS[0] += 1
                NEW[k] = {"result": result, "cost": cost}
            return result
        time.sleep(2)
    with LOCK: FAILS[0] += 1
    return ""
def parse(t):
    s = t.find("{"); e = t.rfind("}") + 1
    try: return json.loads(t[s:e])
    except Exception:
        s = t.find("["); e = t.rfind("]") + 1
        try: return json.loads(t[s:e])
        except Exception: return {}
SYS = "You answer with one JSON object and nothing else."
def load(n): return json.load(open(os.path.join(DATA, n.replace("-vague", "") + ".json")))
PROMPTS = {p["id"]: p for p in json.load(open(os.path.join(ROOT, "judge", "ours-prompts.json")))}
TPL = {
 "turnrel": "turn_relevancy/templates/generate_verdicts.txt",
 "role": "role_adherence/templates/extract_out_of_character_response_verdicts.txt",
 "ccx": "conversation_completeness/templates/extract_user_intentions.txt",
 "ccv": "conversation_completeness/templates/generate_verdicts.txt",
 "tcx": "task_completion/templates/extract_goal_and_outcome.txt",
 "tcv": "task_completion/templates/generate_verdict.txt",
 "hal": "hallucination/templates/generate_verdicts.txt",
 "fcl": "faithfulness/templates/generate_claims.txt",
 "fvd": "faithfulness/templates/generate_verdicts.txt",
 "krv": "knowledge_retention/templates/generate_verdict.txt",
 "geval": "g_eval/templates/generate_strict_evaluation_results.txt",
}
TPL = {k: open(M + v).read() for k, v in TPL.items()}
import re
def strip(t):
    t = t.replace("{{ _fragments.multimodal_input_rules }}", "").replace("{% if multimodal %}{{ _fragments.multimodal_input_rules }}{% endif %}", "")
    t = re.sub(r"\{% if multimodal %\}[\s\S]*?\{% endif %\}", "", t)
    t = re.sub(r"\{% if not multimodal %\}[\s\S]*?\{% endif %\}", "", t)
    t = re.sub(r"\{% if _additional_context %\}[\s\S]*?\{% endif %\}", "", t)
    return t
GEVAL_STEPS = "Read the user ask in this turn.\nCheck whether the reply answers what the user asked in this turn, in any words.\nScore 1 if the reply answers the ask; score 0 if it answers a different question, changes the subject, or ignores the ask."
CONTEXTS = ['Acme Fiber 1000 is available at 14 Harbor Road, Acmeville, at $60 a month.', 'Acme Air 5G gives up to 200 Mbps for $35 a month at 88 Summit Avenue, Acmeville.', 'Acme Mobile M gives 40 GB of data for $25 a month.', 'Acme Mobile L gives unlimited data for $35 a month.', 'The lead reference is LEAD-10C86C.']
ROLE_TEXT = "You are the Acme Telecom sales assistant. Help customers choose and order Acme plans and check coverage. Promise only what Acme can offer, and give no advice or content outside Acme sales."
def ours_vote(iid):
    p = PROMPTS[iid]
    return parse(call(p["system"], p["user"])).get("outcome", "unparsed")
def item(set_name, row):
    iid = row["id"]; res = {"id": iid, "label": row["label"], "ours": ours_vote(({"relevancy-hard2": "p2-", "relevancy-hard2-vague": "vague-"}.get(set_name, "") + iid))}
    if set_name in ("relevancy", "relevancy-hard", "relevancy-hard2", "relevancy-hard2-vague"):
        msgs = [{"role": "user", "content": row["ask"]}, {"role": "assistant", "content": row["reply"]}]
        p = strip(TPL["turnrel"]).replace("{{ sliding_window }}", json.dumps(msgs, indent=1))
        res["deepeval_turnrel"] = str(parse(call(SYS, p)).get("verdict", "unparsed"))
        content = "Input:\n" + row["ask"] + "\n\nActual Output:\n" + row["reply"]
        g = strip(TPL["geval"]).replace("{{ parameters }}", "the ask and the reply").replace("{{ evaluation_steps }}", GEVAL_STEPS).replace("{{ test_case_content }}", content)
        res["deepeval_geval"] = str(parse(call(SYS, g)).get("score", "unparsed"))
    elif set_name == "role":
        msgs = [{"role": "user", "content": "Hello, what can you help me with?"}, {"role": "assistant", "content": row["reply"]}]
        p = strip(TPL["role"]).replace("{{ role }}", ROLE_TEXT).replace("{{ turns }}", json.dumps(msgs, indent=1))
        vv = parse(call(SYS, p)).get("verdicts")
        res["deepeval_role"] = "out" if (bool(vv) if isinstance(vv, list) else (vv not in (None, {}))) else "in"
    elif set_name == "completeness":
        msgs = [m for x in row["turns"] for m in ({"role": "user", "content": x["ask"]}, {"role": "assistant", "content": x["reply"]})]
        turns = json.dumps(msgs, indent=1)
        ints = parse(call(SYS, strip(TPL["ccx"]).replace("{{ turns }}", turns))).get("intentions", [])
        ints = [str(i) for i in ints] if isinstance(ints, list) else []
        yes = 0
        for it in ints:
            vd = parse(call(SYS, strip(TPL["ccv"]).replace("{{ turns }}", turns).replace("{{ intention }}", it)))
            if str(vd.get("verdict")).lower() == "yes": yes += 1
        res["deepeval_cc"] = "complete" if ints and yes / len(ints) >= 0.5 else "incomplete"
    elif set_name == "task":
        inp = "\n".join(x["ask"] for x in row["turns"]); outp = "\n".join(x["reply"] for x in row["turns"])
        e = parse(call(SYS, strip(TPL["tcx"]).replace("{{ input }}", inp).replace("{{ actual_output }}", outp).replace("{{ tools_called_formatted }}", "(none)")))
        vd = parse(call(SYS, strip(TPL["tcv"]).replace("{{ actual_outcome }}", str(e.get("outcome", ""))).replace("{{ task }}", str(e.get("task", "")))))
        try: s = float(vd.get("verdict", 0))
        except Exception: s = 0.0
        res["deepeval_task"] = "complete" if s >= 0.5 else "incomplete"
    elif set_name == "hallucination":
        h = strip(TPL["hal"]).replace("{{ contexts_count }}", str(len(CONTEXTS))).replace("{{ contexts }}", json.dumps(CONTEXTS)).replace("{{ actual_output }}", row["reply"])
        vs = parse(call(SYS, h)).get("verdicts", [])
        no = sum(1 for x in vs if isinstance(x, dict) and str(x.get("verdict")).lower() == "no") if isinstance(vs, list) else 0
        res["deepeval_hal_score"] = no / len(CONTEXTS)
        res["deepeval_hal"] = "invented" if no / len(CONTEXTS) > 0.5 else "grounded"
        claims = parse(call("You answer with a JSON list and nothing else.", TPL["fcl"].replace("{{ actual_output }}", row["reply"]).replace("{{ multimodal_instruction }}", "")))
        claims = [str(c) for c in claims] if isinstance(claims, list) else []
        if claims:
            f = strip(TPL["fvd"]).replace("{{ _fragments.faithfulness_verdicts_format_instruction }}", "").replace("{{ retrieval_context }}", json.dumps(CONTEXTS)).replace("{{ claims }}", json.dumps(claims))
            vv = parse(call(SYS, f)).get("verdicts", [])
            faithful = sum(1 for x in vv if isinstance(x, dict) and str(x.get("verdict")).lower() == "yes") if isinstance(vv, list) else 0
            res["deepeval_faith"] = "grounded" if faithful / len(claims) >= 0.5 else "invented"
        else:
            res["deepeval_faith"] = "grounded"
    elif set_name in ("knowledge", "knowledge2"):
        p = strip(TPL["krv"]).replace("{{ llm_message }}", row["reply"]).replace("{{ accumulated_knowledge }}", json.dumps({"Email": "jo.okafor@example.com"}, indent=1))
        vv = parse(call(SYS, p)).get("verdict")
        res["deepeval_kr"] = "forget" if str(vv).lower() == "yes" else "keep"
    return res
ALL = ["relevancy", "role", "completeness", "task", "hallucination", "knowledge", "knowledge2"]
if __name__ == "__main__":
    sets = ALL if SETS == "all" else SETS.split(",")
    jobs = [(s, row) for s in sets for row in load(s)]
    out = []; t0 = time.time()
    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = {ex.submit(item, s, r): (s, r["id"]) for s, r in jobs}
        for f in as_completed(futs):
            try: out.append({"set": futs[f][0], **f.result()})
            except Cap: pass
            except Exception as e: out.append({"set": futs[f][0], "id": futs[f][1], "error": str(e)[:120]})
    os.makedirs(RES, exist_ok=True)
    json.dump({"model": MODEL, "sets": sets, "cost_usd": round(COST[0], 4), "calls": CALLS[0], "replays": REPLAYS[0], "fails": FAILS[0], "seconds": round(time.time() - t0), "rows": out}, open(os.path.join(RES, f"{MODEL}-{TAG}.json"), "w"), indent=1)
    if NEW:
        with LOCK:
            CASSETTE.update(NEW)
            os.makedirs(os.path.dirname(CAS), exist_ok=True)
            json.dump(CASSETTE, open(CAS, "w"), indent=0, sort_keys=True)
    print("model", MODEL, "rows", len(out), "calls", CALLS[0], "replays", REPLAYS[0], "fails", FAILS[0], "cost", round(COST[0], 4), "seconds", round(time.time() - t0))
