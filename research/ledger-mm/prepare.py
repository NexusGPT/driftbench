"""Seal a label-blind MM-Eval TEST covering sample from observed exposure records."""
import argparse
import hashlib
import itertools
import json
import os
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
GROUPS = ['chat', 'reasoning', 'safety', 'linguistics', 'language mixing']
SEED = 'ledger-mm-never-scored-test-v1'


def sha(x):
    return hashlib.sha256(x if isinstance(x, bytes) else x.encode()).hexdigest()


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def split_of(id):
    return 'dev' if bytes.fromhex(sha('split:mmeval:' + id))[0] < 77 else 'test'


def refuses(text):
    # This is a sampling feature and a deliberately weak cheater, never a harm verdict.
    import re
    pattern = r"\b(?:cannot|can't|unable|sorry|refuse|cannot assist|no puedo|lo siento|je ne peux|désolé|ich kann|tut mir leid|não posso|desculp|non posso|non podo|ezin|maaf|tidak dapat)\b|не могу|извин|不能|无法|抱歉|申し訳|できません|لا أستطيع|لا يمكنني|آسف|죄송|할 수 없"
    return bool(re.search(pattern, text, re.I))


def interactions(row):
    xs = [('group', row['group']), ('language', row['language']),
          ('refusal', str(refuses(row['a']) or refuses(row['b'])))]
    return set(tuple(sorted(p)) for p in itertools.combinations(xs, 2))


def cover(rows, n, seed=SEED):
    """Greedy t=2 coverage, then balanced-subset fill; no label or outcome is read."""
    if len(rows) < n:
        raise ValueError(f'Only {len(rows)} eligible items, need {n}')
    ranked = sorted(rows, key=lambda x: sha(seed + ':' + x['id']))
    universe = set().union(*(interactions(x) for x in rows))
    uncovered = set(universe)
    chosen, counts = [], dict.fromkeys(GROUPS, 0)
    while uncovered:
        r = max(ranked, key=lambda x: len(interactions(x) & uncovered))
        chosen.append(r)
        counts[r['group']] += 1
        ranked.remove(r)
        uncovered -= interactions(r)
        if len(chosen) > n:
            raise ValueError('Pair interaction coverage exceeds pool budget')
    cover_n = len(chosen)
    while len(chosen) < n:
        groups = {x['group'] for x in ranked}
        g = min(groups, key=lambda g: (counts[g], GROUPS.index(g)))
        r = next(x for x in ranked if x['group'] == g)
        chosen.append(r)
        counts[g] += 1
        ranked.remove(r)
    chosen.sort(key=lambda x: sha(seed + ':run:' + x['id']))
    return chosen, {'strength': 2, 'feasibleInteractions': len(universe),
                    'coveredInteractions': len(set().union(*(interactions(x) for x in chosen))),
                    'greedyCoverItems': cover_n, 'subsetCounts': counts,
                    'interactions': [list(x) for x in sorted(universe)]}


def rows_from_text(text, path):
    if path.endswith('.jsonl'):
        return [json.loads(line) for line in text.splitlines() if line.strip()]
    value = json.loads(text)
    return value if isinstance(value, list) else []


def ids_from(rows, path):
    out = set()
    is_mm = any(s in path for s in ['mmeval/', 'mm-results/', 'astra-mm/data/', 'rep-', 'rec-copy', '/pw.jsonl', '/pivot.jsonl'])
    for r in rows:
        if not isinstance(r, dict):
            continue
        if r.get('bench') and r['bench'] != 'mmeval':
            continue
        if r.get('bench') != 'mmeval' and not is_mm:
            continue
        value = r.get('item', r.get('id', r.get('itemId')))
        if isinstance(value, dict):
            value = value.get('id')
        if value is not None and str(value).isdigit():
            out.add(str(value))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--repo', type=Path, required=True)
    ap.add_argument('--scratch', type=Path, required=True)
    ap.add_argument('--cache', type=Path, default=Path(tempfile.gettempdir()) / 'driftbench-judge-benchmarks')
    args = ap.parse_args()
    raw, pages = [], []
    for offset in range(0, 10000, 100):
        url = 'https://datasets-server.huggingface.co/rows?dataset=prometheus-eval/MM-Eval&config=default&split=test'
        url += f'&offset={offset}&length=100'
        body = (args.cache / sha(url)[:16]).read_bytes()
        page = json.loads(body)
        pages.append({'url': url, 'sha256': sha(body)})
        raw += page['rows']
        if offset + 100 >= page['num_rows_total']:
            break
    all_rows = []
    for value in raw:
        row, id = value['row'], str(value['row_idx'])
        if row['subset'] not in GROUPS:
            continue
        first = bytes.fromhex(sha('mmeval:' + id))[0] % 2 == 0
        all_rows.append({'id': id, 'group': row['subset'], 'language': row['language'],
                         'question': row['prompt'], 'a': row['chosen'] if first else row['rejected'],
                         'b': row['rejected'] if first else row['chosen'], 'label': 'A' if first else 'B'})
    excluded, inventory, scopes = set(), [], []

    def consume(label, body):
        found = ids_from(rows_from_text(body.decode(), label), label)
        excluded.update(found)
        inventory.append({'source': label, 'sha256': sha(body), 'recordedIds': sorted(found, key=int), 'count': len(found)})

    worktrees = ['opus-council', 'codex-jb', 'codex-mm', 'codex-rb', 'codex-verify',
                 'codex-wp', 'judge-benchmarks', 'astra-hard', 'astra-mm', 'opus-mm']
    for wt in worktrees:
        root = args.repo / '.worktrees' / wt
        scopes.append({'path': str(root), 'exists': root.exists()})
        if not root.exists():
            continue
        for folder, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in {'node_modules', '.git', 'tmp', 'runtime', 'frozen-source', '.worktrees', '.cache', '__pycache__'}]
            for f in sorted(files):
                p = Path(folder) / f
                rel = str(p.relative_to(root))
                if f.endswith('.jsonl') and ('recordings/' in rel or 'mm-results/' in rel or 'astra-mm/data/' in rel):
                    if f == 'tasks.jsonl':
                        continue  # Queued requests are not recordings.
                    consume(str(p), p.read_bytes())
    # Deleted worktrees remain auditable through their immutable branch blobs.
    refs = {'codex/mm-judge', 'research/astra-hard-fresh', 'research/astra-mm-replicate'}
    for ref in sorted(refs):
        commit = git('rev-parse', ref).decode().strip()
        scopes.append({'ref': ref, 'commit': commit})
        for p in git('ls-tree', '-r', '--name-only', ref).decode().splitlines():
            if p.endswith('.jsonl') and ('recordings/' in p or 'mm-results/' in p or 'astra-mm/data/' in p):
                consume(f'{commit}:{p}', git('show', f'{commit}:{p}'))
    for name in ['rec-copy.jsonl', 'rep-frozen.jsonl', 'rep-pw.jsonl', 'rep-solve.jsonl', 'pw.jsonl', 'pivot.jsonl']:
        p = args.scratch / 'opus' / name
        if p.exists():
            consume(str(p), p.read_bytes())

    sample_path = 'examples/judge-benchmarks/experiments/mm-results/test-sample-frozen-items.json'
    sample_body = git('show', 'codex/mm-judge:' + sample_path)
    old_sample = json.loads(sample_body)
    old_ids = {str(x['id'] if isinstance(x, dict) else x) for x in old_sample['items']}
    assert len(old_ids) == 950
    excluded.update(old_ids)
    inventory.append({'source': 'codex/mm-judge:' + sample_path, 'sha256': sha(sample_body), 'count': len(old_ids), 'recordedIds': sorted(old_ids, key=int), 'reason': 'entire frozen sample excluded, including uncalled items'})
    dev400_body = (args.repo / '.worktrees/opus-council/examples/council/inputs/mm-dev400-ids.json').read_bytes()
    dev400_ids = set(map(str, json.loads(dev400_body)))
    excluded.update(dev400_ids)
    fresh_dev = [r for r in all_rows if split_of(r['id']) == 'dev' and r['id'] not in excluded]
    eligible = [r for r in all_rows if split_of(r['id']) == 'test' and r['id'] not in excluded]
    selected, coverage = cover(eligible, 600)
    selected_ids = {r['id'] for r in selected}
    assert not selected_ids & excluded
    # Warm-up material is already exposed DEV only. TEST never enters a pilot or fixture.
    dev400_rows = [r for r in all_rows if r['id'] in dev400_ids]
    pilot = []
    for g in GROUPS:
        pilot += sorted([r for r in dev400_rows if r['group'] == g], key=lambda r: sha(SEED + ':pilot:' + r['id']))[:4]
    noise = []
    for g in GROUPS:
        noise += sorted([r for r in dev400_rows if r['group'] == g], key=lambda r: sha(SEED + ':noise:' + r['id']))[:6]
    HERE.joinpath('artifacts').mkdir(exist_ok=True)
    out = HERE / 'artifacts'
    dump(out / 'pool.json', selected)
    dump(out / 'pilot.json', pilot)
    dump(out / 'noise.json', noise)
    dump(out / 'excluded-ids.json', sorted(excluded, key=int))
    dump(out / 'exposure-audit.json', {'scopes': scopes, 'files': inventory, 'pages': pages,
                                      'dev400Sha256': sha(dev400_body), 'testSampleSha256': sha(sample_body)})
    summary = {'poolLabel': 'never-scored TEST', 'seed': SEED, 'count': len(selected),
               'corePopulation': len(all_rows), 'devPopulation': sum(split_of(r['id']) == 'dev' for r in all_rows),
               'testPopulation': sum(split_of(r['id']) == 'test' for r in all_rows),
               'remainingNeverScoredDev': len(fresh_dev), 'eligibleTest': len(eligible),
               'excludedIds': len(excluded), 'sources': len(inventory), 'coverage': coverage,
               'selectionUsesLabels': False, 'testTuningAllowed': False,
               'hashes': {p.name: sha(p.read_bytes()) for p in out.iterdir() if p.suffix == '.json' and p.name != 'pool-seal.json'}}
    dump(out / 'pool-seal.json', summary)
    print(json.dumps({k: v for k, v in summary.items() if k not in {'coverage', 'hashes'}}, indent=2))
    print(json.dumps({k: v for k, v in coverage.items() if k != 'interactions'}, indent=2))


if __name__ == '__main__':
    main()
