"""Verify the reviewed scanner value occurs in our frozen synthetic inputs without printing it."""
import json,pathlib,re
ROOT=pathlib.Path(__file__).parent
import subprocess,sys
subprocess.run([sys.executable,str(ROOT/'restore-recordings.py')],check=True,stdout=subprocess.DEVNULL)
call=json.loads((ROOT/'recorded/calls.jsonl').read_text().splitlines()[5057])
values=set(re.findall(r'token=([A-Za-z0-9_-]+)',call['text']))
paths=set(json.loads((ROOT/'frozen.json').read_text())['fixtureHashes'])
paths.update(['judges-entries-v2.json','longtrace-v2/hard.json'])
hits={value:[p for p in sorted(paths) if value in (ROOT/p).read_text()] for value in values}
proven=bool(values) and all(hits.values())
print('Flagged distinct token values:',len(values))
print('Every value occurs in our frozen synthetic fixture inputs:',proven)
print('Matching fixture files:',sorted({p for matches in hits.values() for p in matches}))
print('No token value printed.')
if not proven:raise SystemExit(1)
