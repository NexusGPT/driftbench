"""Combine the three lane manifests (DeepEval, promptfoo and Langfuse, Inspect) into one driver manifest."""
import hashlib, json, sys
from pathlib import Path

LANES = ['deepeval', 'promptfoo-langfuse', 'inspect']
src, out = Path(sys.argv[1]), Path(sys.argv[2])
datasets, rows = [], []
for lane in LANES:
    m = json.loads((src / lane / 'manifest.json').read_text())
    assert m['model'] == 'claude-haiku-5-5'
    datasets += m['datasets']
    rows += [{**r, 'lane': lane} for r in m['rows']]
names = [d['name'] for d in datasets]
assert len(names) == len(set(names)), 'dataset names must be unique'
by_name = {d['name']: d for d in datasets}
for r in rows:
    ids = {i['id'] for i in by_name[r['dataset']]['items']}
    assert r['n'] == len(ids) == len(r['peerCorrect']) == len(r['oldOursCorrect'])
    assert set(r['peerCorrect']) == ids == set(r['oldOursCorrect']), r['row']
    assert sum(r['peerCorrect'].values()) == r['recorded']['theirs'], r['row']
    assert sum(r['oldOursCorrect'].values()) == r['recorded']['ours'], r['row']
for d in datasets:
    for i in d['items']:
        assert i['gold'] in ('pass', 'fail') and isinstance(i['request'], dict)
manifest = {'version': 1, 'model': 'claude-haiku-5-5', 'datasets': datasets, 'rows': rows}
text = json.dumps(manifest, ensure_ascii=False, indent=1) + '\n'
out.write_text(text)
print(json.dumps({'datasets': len(datasets), 'items': sum(len(d['items']) for d in datasets), 'rows': len(rows),
                  'sha256': hashlib.sha256(text.encode()).hexdigest()}))
