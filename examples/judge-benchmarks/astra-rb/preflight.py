"""Question-only program execution. This runs before either candidate answer."""
import json, traceback, copy
plan=json.load(open("plan.json"))
out={"checks":[],"inputs":[],"rejected":[],"reference_errors":[],"examples":[],"validator_probes":[]}
for i,c in enumerate(plan.get("checks",[])):
    row={"index":i}
    try:
        ns={}
        exec(c["python"],ns)
        row["positive"]=ns["check"](c["positive"])
        row["negative"]=ns["check"](c["negative"])
        row["valid"]=row["positive"] is True and row["negative"] is False
    except Exception as e: row.update(valid=False,error=type(e).__name__+": "+str(e))
    out["checks"].append(row)
e=plan.get("execution")
if e:
    try:
        # These are fragments of one generated test module. Shared parsing helpers
        # may be used by the validator and oracle, but neither sees candidate code.
        gen={}
        exec(e["generator"],gen)
        val=dict(gen)
        exec(e["validator"],val)
        ref=dict(val)
        if e.get("reference"): exec(e["reference"],ref)
        raw=gen["generate"]()
        if not isinstance(raw,list) or len(raw)>100: raise ValueError("invalid generator shape/size")
        for x in [None,{},[],1,True,"malformed"]:
            try: out["validator_probes"].append({"input":x,"valid":val["valid"](x) is True})
            except Exception as err: out["validator_probes"].append({"input":x,"valid":False,"error":str(err)})
        seen=set()
        for x in raw+[r["input"] for r in e.get("examples",[])]:
            key=json.dumps(x,sort_keys=True,allow_nan=False)
            if key in seen: continue
            seen.add(key)
            if val["valid"](x) is not True:
                out["rejected"].append(x); continue
            row={"id":"t"+str(len(out["inputs"])),"input":x}
            try:
                if "reference" in ref:
                    expected=ref["reference"](copy.deepcopy(x))
                    json.dumps(expected,allow_nan=False)
                    row["expected"]=expected
                    row["oracle"]="reference"
                else:
                    match=next((r for r in e.get("examples",[]) if r["input"]==x),None)
                    if match: row.update(expected=match["expected"],oracle="supplied_example")
            except Exception as err: out["reference_errors"].append({"input":x,"error":str(err)})
            out["inputs"].append(row)
        for ex in e.get("examples",[]):
            row={"input":ex["input"],"expected":ex["expected"]}
            if "reference" in ref:
                try:
                    row["actual"]=ref["reference"](copy.deepcopy(ex["input"]))
                    row["pass"]=row["actual"]==ex["expected"]
                except Exception as err: row.update(error=str(err),**{"pass":False})
            out["examples"].append(row)
    except Exception as err: out["execution_error"]=type(err).__name__+": "+str(err)
print(json.dumps(out,allow_nan=False))
