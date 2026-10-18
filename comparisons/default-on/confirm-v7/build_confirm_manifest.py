"""Build the v7 held-out confirmation manifest from pinned VerifyBench-Hard rows and the frozen confirmation split."""
import hashlib, json, sys, unicodedata
from pathlib import Path
D = Path(sys.argv[1])
raw = (D / 'raw/verify_bench_hard.jsonl').read_bytes()
assert hashlib.sha256(raw).hexdigest() == '1b405149e8e7307dc04e2b35dc1fcceec371ab8e7c68af9f74e5918503c0298d'
rows = {f"{r['question_id']}_{r['completion_id']}": r for r in (json.loads(l) for l in raw.decode().splitlines() if l.strip())}
index = json.loads((D / 'confirmation-index.json').read_text())
excluded = set(json.loads((D / 'confirmation-exclusions.json').read_text())['excludedIds'])
CRITERION = 'The final answer the response gives to the question is correct.'
key = lambda text: ' '.join(unicodedata.normalize('NFC', text).split())
items = []
for entry in index['splits']['confirm']:
    if entry['id'] in excluded:
        continue
    r = rows[entry['id']]
    assert hashlib.sha256(key(r['question']).encode()).hexdigest() == entry['questionSha256']
    assert r['gold_correct'] is entry['label']
    items.append({'id': entry['id'], 'gold': 'pass' if r['gold_correct'] else 'fail',
                  'request': {'criterion': {'name': 'answer_correctness', 'rubric': CRITERION},
                              'transcript': [{'role': 'user', 'text': r['question']}, {'role': 'agent', 'text': r['completion']}]}})
assert len(items) == 536 and len({i['id'] for i in items}) == 536
manifest = {'version': 1, 'model': 'claude-haiku-5-5',
            'datasets': [{'name': 'verify-confirm536', 'baselines': {}, 'optional': False,
                          'note': 'VerifyBench-Hard confirmation split of the verify-lead lane (pinned source 1b405149), minus 8 items sharing a question with practice or dev. Never used to tune or diagnose default-on; used once to confirm the benchmark-only verify-lead v5.',
                          'items': items}],
            'sources': {'verifybench-hard': index['sources']['verifybench-hard'], 'split': 'origin/feat/verify-lead examples/verify-lead/data/confirmation-index.json', 'exclusions': 'origin/feat/verify-lead examples/verify-lead/confirmation-exclusions.json'}}
text = json.dumps(manifest, ensure_ascii=False, indent=1) + '\n'
(D / 'confirm-manifest.json').write_text(text)
print(json.dumps({'items': len(items), 'pass': sum(i['gold'] == 'pass' for i in items), 'fail': sum(i['gold'] == 'fail' for i in items), 'sha256': hashlib.sha256(text.encode()).hexdigest()}))
