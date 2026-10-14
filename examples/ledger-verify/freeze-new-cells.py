"""Freeze the two owner-authorized model additions before any paid request."""
import ast,datetime,hashlib,json,os
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[1]
def read(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
stamp=datetime.datetime.now(datetime.timezone.utc).isoformat();original=read(BASE/'evidence/runtime-freeze.json')
for folder,model in [('sonnet','claude-sonnet-5-5'),('sol61','gpt-6.1-sol')]:
 b=BASE/folder
 assert not (b/'receipts/calls.jsonl').exists(), 'Cannot re-freeze after a provider call'
 hashes=dict(original['hashes'])
 for name in ['new-cell-run.ts','new-cell-transport.ts','new-cell-transport.sh','new-cell-budget.py','responses-adapter.ts','schemas.ts','capture-claude.sh','quota.ts','new-cell-supervise.py','transport-retry.py','evidence/new-model-cost-sample.json']:
  p=BASE/name;hashes[str(p.relative_to(ROOT))]=sha(p)
 ns=folder+'-medium-20261013'
 runtime={**original,'id':ns,'recordingsId':ns,'pilotRecordingsId':ns,'models':{model:{'timeoutMs':300000,'reasoning':'medium'}},'capUsd':25,'modelConcurrency':{model:2},'command':'examples/ledger-verify/new-cell-transport.sh','deadlineAt':None,'hashes':hashes,
  'outerTimeoutMs':2147483647,
  'transportIdentity':'responses-standard-medium-output32768-v1' if folder=='sol61' else 'claude-cli-lean-sonnet-medium-output16384-v1'}
 (b/'evidence/runtime-freeze.json').write_text(json.dumps(runtime,indent=2)+'\n')
 (b/'evidence/pilot-runtime-freeze.json').write_text(json.dumps(runtime,indent=2)+'\n')
 reporting={str((b/name).relative_to(ROOT)):sha(b/name) for name in ['stats.py','validate.py','summarize.py','output_limits.py']}
 reporting[str((BASE/'new-cell-trace.ts').relative_to(ROOT))]=sha(BASE/'new-cell-trace.ts')
 # Scoring function bodies must exactly match the original frozen implementations.
 comparisons={}
 for name in ['stats.py','validate.py']:
  def functions(path):
   tree=ast.parse(path.read_text());return {n.name:ast.dump(n,include_attributes=False) for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name!='main'}
  assert functions(b/name)==functions(BASE/name),name
  comparisons[name]='all non-main function ASTs identical to original frozen source'
 (b/'evidence/reporting-freeze.json').write_text(json.dumps(dict(at=stamp,sourceHashes=reporting,algorithmEquality=comparisons),indent=2)+'\n')
 amendment=read(b/'evidence/model-amendment.json');amendment.update(status='frozen before first provider call',frozenAt=stamp,runtimeSha256=sha(b/'evidence/runtime-freeze.json'),reportingSha256=sha(b/'evidence/reporting-freeze.json'))
 (b/'evidence/model-amendment.json').write_text(json.dumps(amendment,indent=2)+'\n')
 print(model,'frozen',sha(b/'evidence/runtime-freeze.json'))
