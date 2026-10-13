"""Archive completed local evidence with byte hashes, without model calls."""
from pathlib import Path
import hashlib,json,shutil
root=Path(__file__).parent
runtime=root/'runtime'
out=root/'results'
state=json.loads((runtime/'meter-state.json').read_text())
assert not state['active'], 'Wait for owned model calls to finish before archiving.'
out.mkdir(exist_ok=True)
paths=[p for p in runtime.iterdir() if p.suffix in ['.json','.jsonl'] and p.is_file()]
paths+=list((runtime/'recordings').rglob('*.jsonl'))
manifest={}
for p in sorted(paths):
    target=out/p.relative_to(runtime)
    target.parent.mkdir(parents=True,exist_ok=True)
    data=p.read_bytes()
    if p.suffix=='.json':json.loads(data)
    else:
        for line in data.splitlines():
            if line:json.loads(line)
    target.write_bytes(data)
    assert target.read_bytes()==data
    manifest[str(target.relative_to(root))]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
codeJournal=root.parents[1]/'examples/judge-benchmarks/experiments/rb/execution.jsonl'
if codeJournal.exists():
    data=codeJournal.read_bytes();target=out/'rb-execution.jsonl';target.write_bytes(data)
    for line in data.splitlines():
        if line:json.loads(line)
    manifest[str(target.relative_to(root))]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
(out/'evidence-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'archivedFiles':len(manifest),'bytes':sum(x['bytes'] for x in manifest.values()),'spent':state['spent'],'calls':state['calls']}))
