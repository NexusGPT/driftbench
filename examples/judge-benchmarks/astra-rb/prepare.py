"""Copy DEV only from the existing public cache. No test row is written or sent to a model."""
import hashlib,json,os,shutil,argparse
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument("--source",required=True,help="Read-only frozen codex-rb worktree")
p.add_argument("--cache",required=True,help="Existing public benchmark cache directory")
args=p.parse_args()
src=Path(args.source);cached=Path(args.cache)
dst=Path("examples/judge-benchmarks/astra-rb")
out=Path(".cache/astra-rb");out.mkdir(parents=True,exist_ok=True)
reports=json.loads((src/"examples/judge-benchmarks/experiments/rb/audit.json").read_text())["reports"]
baseline=next(x for x in reports if x["contestant"]=="driftbench-rb-binary-canonical-executed")
assert baseline["completeItems"]==357
(dst/"baseline-dev.json").write_text(json.dumps(baseline,indent=2)+"\n")
shutil.copyfile(src/"examples/judge-benchmarks/experiments/rb/frozen-design.json",dst/"frozen-design.json")
base="https://datasets-server.huggingface.co/rows?dataset=DonJoey/rubricbench&config=default&split=train"
rows=[]
for offset in range(0,1200,100):
    key=hashlib.sha256((base+f"&offset={offset}&length=100").encode()).hexdigest()[:16]
    page=json.loads((cached/key).read_text())
    for item in page["rows"]:
        r=item["row"];id=r["case_id"]
        if hashlib.sha256(("split:rubricbench:"+id).encode()).digest()[0]>=77:continue
        rows.append(dict(kind="pair",id=id,question=r["instruction"],a=r["response_a"],b=r["response_b"],
                         group=r["domain"],criterion="The response satisfies the rubrics below better.\n"+r["rubrics"]))
    if offset+100>=page["num_rows_total"]:break
assert len(rows)==357
assert {x["id"] for x in rows}=={x["id"] for x in baseline["details"]}
(out/"dev-inputs.json").write_text(json.dumps(rows,indent=2)+"\n")
print(json.dumps({"dev_inputs":len(rows),"baseline_items":baseline["completeItems"]}))
