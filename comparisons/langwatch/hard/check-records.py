"""Verify scored population coverage, recording references, costs and frozen inputs."""
import hashlib,json,pathlib
HERE=pathlib.Path(__file__).parent
import subprocess,sys
subprocess.run([sys.executable,str(HERE/'restore-recordings.py')],check=True,stdout=subprocess.DEVNULL)
summary=json.loads((HERE/'recorded/summary.json').read_text())
assert summary['uniqueSpendUsd']<=8
frozen=json.loads((HERE/'frozen.json').read_text())
for p,digest in {**frozen['sourceHashes'],**frozen['fixtureHashes']}.items():
 assert hashlib.sha256((HERE/p).read_bytes()).hexdigest()==digest,p
calls=[json.loads(l) for l in (HERE/'recorded/calls.jsonl').read_text().splitlines()]
by_key={c['request_sha256']:c for c in calls}
assert len(by_key)==len(calls),'Repeated raw call keys'
for path in (HERE/'recorded').glob('*.json'):
 data=json.loads(path.read_text())
 if 'answers' not in data:continue
 answers=data['answers'];assert len({a['id'] for a in answers})==len(answers),path
 assert data['complete'] and len(answers)==data['expected'],path
 for answer in answers:
  keys=answer.get('request_sha256s') or [answer['request_sha256']]+([answer['audit_request_sha256']] if answer.get('audit_request_sha256') else [])
  assert all(key in by_key for key in keys),(path,answer['id'])
  assert abs(sum(by_key[key]['costUsd'] for key in keys)-answer['costUsd'])<1e-10,(path,answer['id'])
  if answer.get('unscored'):assert any(by_key[key]['failed'] for key in keys),(path,answer['id'])
for key,row in summary['rows'].items():
 assert row['complete'],key
 assert row['n']+row['unscored']==row['total'],key
 assert row['correct']+len(row['wrong_ids'])==row['n'],key
print(f"All {len(summary['rows'])} score rows complete; raw keys/costs, coverage, budget and frozen inputs verified.")
