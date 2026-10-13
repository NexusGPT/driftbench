import json, shutil, hashlib
from pathlib import Path
HERE=Path(__file__).resolve().parent
WT=HERE.parents[2]
SOURCE=WT.parent/'codex-verify/examples/judge-benchmarks'
WP=WT.parent/'opus-wp/examples/judge-benchmarks'
def read(p): return json.loads(p.read_text())
def save(name,data): (HERE/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
items=read(SOURCE/'results/verify-dev/items.json')
assert len(items)==95
ids={r['id'] for r in items}
assert all(hashlib.sha256(f"split:longjudge-verify:{i}".encode()).digest()[0]<77 for i in ids)
save('verify-dev-items.json',items)
for name in ['driftbench-verify-uncertainty-cascade.json','label-audit.json']:
 shutil.copyfile(SOURCE/'results/verify-dev'/name,HERE/name)
shutil.copyfile(WP/'census/wp-holistic-freeze-candidate-dev.json',HERE/'writing-holistic-dev.json')
shutil.copyfile(WP/'census/wp-label-audit-dev.json',HERE/'writing-audit-dev.json')
recdir=HERE/'recordings/longjudge-verify';recdir.mkdir(parents=True,exist_ok=True)
for name in ['haiku.jsonl','program-outputs.jsonl']:
 with (SOURCE/'recordings/longjudge-verify'/name).open() as src, (recdir/name).open('w') as dst:
  for line in src:
   r=json.loads(line)
   if r.get('item') in ids: dst.write(line)
solver=read(Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/opus/verify-boardgame-result.json'))
save('solver-dev.json',solver)
manifest={str(p.relative_to(HERE)):hashlib.sha256(p.read_bytes()).hexdigest() for p in HERE.rglob('*') if p.is_file() and p.suffix in ['.json','.jsonl']}
save('source-hashes.json',manifest)
print('Prepared 95 DEV items and frozen evidence; no score computed.')
