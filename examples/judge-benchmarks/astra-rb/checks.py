import json, hashlib
data=json.load(open("checks.json"))
out={"results":[]}
for c in data["checks"]:
    row={"index":c["index"],"name":c["name"],"source_quote":c["source_quote"],"programHash":hashlib.sha256(c['python'].encode()).hexdigest()}
    try:
        ns={};exec(c["python"],ns)
        for side in ["a","b"]:
            try:
                v=ns["check"](data[side])
                row[side]=v if isinstance(v,bool) else None
            except Exception as e: row[side]=None;row[side+"_error"]=str(e)
    except Exception as e: row.update(a=None,b=None,error=str(e))
    out["results"].append(row)
print(json.dumps(out))
