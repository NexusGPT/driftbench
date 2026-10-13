"""Builds data/practice.json from the practice splits and recorded gpt-6-luna baselines of the ledger harnesses.

Reads other worktrees only (never writes there) and never opens a sealed pool or test file.
"""
import json, os, sys
W = sys.argv[1] if len(sys.argv) > 1 else '/Users/assem/Documents/GitHub/driftbench/.worktrees'
out = []
def lines(path):
    with open(path) as handle:
        return [json.loads(line) for line in handle if line.strip()]

# JudgeBench: preparation pairs from the GPT-4o dev split (pilot, noise, fixtures).
jb = f'{W}/ledger-jb/examples/ledger-jb'
base = {}
for phase in ['pilot', 'noise', 'fixtures']:
    for row in lines(f'{jb}/results/decisions-{phase}-gpt-6-luna.jsonl'):
        if row.get('repeat', 0) != 0: continue
        entry = {'games': row['games']}
        if row['contestant'] == 'ledger':
            entry['calls'] = row.get('calls'); entry['status'] = row.get('status')
        base.setdefault(row['itemId'], {})[row['contestant']] = entry
for phase in ['pilot', 'noise', 'fixtures']:
    for item in json.load(open(f'{jb}/data/{phase}.json')):
        out.append({'bench': 'judgebench', 'split': phase, 'id': item['id'], 'group': item['group'], 'language': 'en',
                    'question': item['question'], 'a': item['a'], 'b': item['b'], 'label': item['label'],
                    'baselines': base.get(item['id'], {})})

# MM-Eval: pilot and noise from the exposed DEV400.
mm = f'{W}/ledger-mm/research/ledger-mm'
base = {}
for row in lines(f'{mm}/recordings/decisions.jsonl'):
    if row.get('model') != 'gpt-6-luna' or row.get('phase') not in ('pilot', 'noise') or row.get('repeat', 0) != 0: continue
    entry = {'games': row['games']}
    if row['contestant'] == 'ledger':
        entry['calls'] = (row.get('result') or {}).get('calls'); entry['status'] = (row.get('result') or {}).get('status')
    base.setdefault(str(row['id']), {})[row['contestant']] = entry
for phase in ['pilot', 'noise']:
    for item in json.load(open(f'{mm}/artifacts/{phase}.json')):
        out.append({'bench': 'mmeval', 'split': phase, 'id': str(item['id']), 'group': item['group'], 'language': item['language'],
                    'question': item['question'], 'a': item['a'], 'b': item['b'], 'label': item['label'],
                    'baselines': base.get(str(item['id']), {})})

# Writing preference: pilot and dev.
wp = f'{W}/ledger-wp/examples/ledger-wp'
base = {}
for row in lines(f'{wp}/results/decisions.jsonl'):
    if row.get('model') != 'gpt-6-luna' or row.get('split') not in ('pilot', 'dev') or row.get('sample', 0) != 0: continue
    name = {'pair-ledger': 'ledger', 'promptfoo': 'promptfoo'}.get(row['contestant'])
    if not name: continue
    entry = {'games': row['games'], 'calls': row.get('callCount'), 'costUsd': row.get('costUsd')}
    base.setdefault(row['id'], {})[name] = entry
for phase in ['pilot', 'dev']:
    for item in json.load(open(f'{wp}/seals/{phase}.json')):
        out.append({'bench': 'writing', 'split': phase, 'id': item['id'], 'group': item.get('tag', ''), 'language': item['language'],
                    'question': item['question'], 'a': item['a'], 'b': item['b'], 'label': item['label'],
                    'baselines': base.get(item['id'], {})})
for bench in ('judgebench', 'mmeval', 'writing'):
    rows = [{k: v for k, v in x.items() if k != 'bench'} for x in out if x['bench'] == bench]
    json.dump(rows, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', bench + '.json'), 'w'), ensure_ascii=False)
import collections
print(collections.Counter((x['bench'], x['split'], tuple(sorted(x['baselines']))) for x in out))
