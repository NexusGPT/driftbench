"""Offline overlap audit and exact paired reanalysis of the frozen confirmation decisions.

python examples/verify-lead/reanalyze.py --check
No model calls or downloads. --prepare rebuilds the compact label/question-hash index from locally
restored frozen practice/confirm files and data/dev.json (pool.py --check; dev.py).
"""
import argparse
import hashlib
import json
from pathlib import Path

import lead_stats as stats
import pool

ROOT = Path(__file__).resolve().parent
CONTESTANTS = ('driftbench-v5', *stats.PEERS)
NORMALIZATION = 'Unicode NFC, collapse whitespace, preserve case and mathematical symbols'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def prepare():
    manifest = json.loads((ROOT / 'data/manifest.json').read_text())
    splits = {}
    for split in ('practice', 'dev', 'confirm'):
        raw = (ROOT / 'data' / f'{split}.json').read_bytes()
        if split in manifest['splits']:
            assert sha(raw) == manifest['splits'][split]['itemsSha256']
        items = json.loads(raw)
        splits[split] = [{'id': x['id'], 'label': x['label'],
                          'questionSha256': sha(pool.question_key(x['question']).encode())} for x in items]
    return {'normalization': NORMALIZATION, 'sources': manifest['sources'],
            'manifestSha256': sha((ROOT / 'data/manifest.json').read_bytes()), 'splits': splits}


def decisions(split, contestant):
    path = ROOT / 'cells' / split / contestant / 'decisions.jsonl'
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    assert len({r['id'] for r in rows}) == len(rows), f'duplicate decisions: {path}'
    assert all(r.get('pass') is None or isinstance(r['pass'], bool) for r in rows)
    return {r['id']: r for r in rows}


def exclusions(index):
    seen = {}
    for split in ('practice', 'dev'):
        for item in index['splits'][split]:
            seen.setdefault(item['questionSha256'], []).append({'split': split, 'id': item['id']})
    practice_keys = {k for row in decisions('practice', 'driftbench-v5').values() for k in row['callKeys']}
    confirm = decisions('confirm', 'driftbench-v5')
    rows = []
    for item in index['splits']['confirm']:
        matches = seen.get(item['questionSha256'], [])
        reused = sorted(set(confirm[item['id']]['callKeys']) & practice_keys)
        if matches:
            rows.append({'id': item['id'], 'questionSha256': item['questionSha256'],
                         'overlaps': matches, 'reusedPracticeCallKeys': reused})
        else:
            assert not reused, f"retained item reuses practice calls: {item['id']}"
    return {'rule': 'exclude confirmation items whose normalized question occurs in practice or dev',
            'normalization': NORMALIZATION, 'frozenN': len(index['splits']['confirm']),
            'retainedN': len(index['splits']['confirm']) - len(rows),
            'excludedIds': [r['id'] for r in rows], 'items': rows}


def analyze(items):
    labels = {i['id']: i['label'] for i in items}
    assert len(labels) == len(items) and all(isinstance(v, bool) for v in labels.values())
    cells = {c: decisions('confirm', c) for c in CONTESTANTS}
    assert all(set(labels) <= set(cell) for cell in cells.values()), 'absent decision records'
    right = {c: {i: cell[i].get('pass') == label for i, label in labels.items()} for c, cell in cells.items()}
    tables = {}
    for contestant in CONTESTANTS:
        own = {'contestant': contestant, 'correct': sum(right[contestant].values()), 'n': len(items),
               'missing': sum(cells[contestant][i].get('pass') is None for i in labels)}
        peers = []
        for peer in CONTESTANTS:
            if peer == contestant:
                continue
            wins = sum(right[contestant][i] and not right[peer][i] for i in labels)
            losses = sum(right[peer][i] and not right[contestant][i] for i in labels)
            peers.append({'peer': peer, 'correct': sum(right[peer].values()), 'wins': wins, 'losses': losses,
                          'p': stats.exact_p(wins, losses),
                          'missing': sum(cells[peer][i].get('pass') is None for i in labels)})
        for row, adjusted in zip(peers, stats.holm([p['p'] for p in peers])):
            row['holm'] = adjusted
            row['verdict'] = ('win' if row['wins'] > row['losses'] else 'loss') if adjusted < 0.05 else 'tie'
        tables[contestant] = {'own': own, 'peers': peers}
    return tables


def artifacts(index):
    manifest = json.loads((ROOT / 'data/manifest.json').read_text())
    assert index['manifestSha256'] == sha((ROOT / 'data/manifest.json').read_bytes())
    for split in ('practice', 'confirm'):
        assert [r['id'] for r in index['splits'][split]] == manifest['splits'][split]['ids']
    excluded = exclusions(index)
    ids = set(excluded['excludedIds'])
    full = index['splits']['confirm']
    primary = analyze([i for i in full if i['id'] not in ids])
    sensitivity = analyze(full)
    frozen = json.loads((ROOT / 'results-confirm.json').read_text())
    assert frozen['driftbench'] == sensitivity['driftbench-v5']['own']
    assert frozen['peers'] == sensitivity['driftbench-v5']['peers']
    provenance = {c: sha((ROOT / 'cells/confirm' / c / 'decisions.jsonl').read_bytes()) for c in CONTESTANTS}
    result = {'analysis': 'item unit; missing verdict wrong; exact two-sided binomial; Holm over five peers per contestant; alpha 0.05',
              'selection': 'post-review question-overlap exclusion, independent of labels and verdicts; not a new preregistration',
              'indexSha256': sha((ROOT / 'data/confirmation-index.json').read_bytes()),
              'decisionSha256': provenance, 'primary': primary, 'sensitivity': sensitivity}
    return {'confirmation-exclusions.json': excluded, 'results-confirm-clean.json': result}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--prepare', action='store_true', help='rebuild the compact audit index from local item files')
    ap.add_argument('--check', action='store_true', help='compare outputs to committed artifacts without writing')
    args = ap.parse_args()
    path = ROOT / 'data/confirmation-index.json'
    if args.prepare:
        index = prepare()
        if args.check:
            assert json.loads(path.read_text()) == index, 'audit index differs from source items'
        else:
            path.write_text(json.dumps(index, indent=2) + '\n')
    index = json.loads(path.read_text())
    for name, value in artifacts(index).items():
        output = ROOT / name
        if args.check:
            assert json.loads(output.read_text()) == value, f'{name} differs'
        else:
            output.write_text(json.dumps(value, indent=2) + '\n')
    clean = artifacts(index)['results-confirm-clean.json']['primary']['driftbench-v5']
    print(stats.markdown('confirm-clean', clean['own'], clean['peers']))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
