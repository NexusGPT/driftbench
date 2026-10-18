"""Copy the sealed TEST items and the recorded Haiku driftbench and promptfoo decisions
from the research/ledger-* branches into data/. No model call. Checks that each recorded
score reproduces before writing anything."""
import argparse
import hashlib
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]


def git(*args):
    return subprocess.run(['git', *args], cwd=REPO, check=True, capture_output=True).stdout


def show(branch, path):
    return git('show', f'{branch}:{path}')


def jsonl(raw):
    return [json.loads(line) for line in raw.decode().splitlines() if line.strip()]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def official(games, label):
    # JudgeBench official pair-net score (examples/ledger-jb/src/statistics.mjs officialCorrect).
    return int(sum(1 if g == label else -1 if g in ('A', 'B') else 0 for g in games) > 0)


def judgebench(branch):
    pool_raw = show(branch, 'examples/ledger-jb/data/pool.json')
    rec_raw = show(branch, 'examples/ledger-jb/results/items-claude-haiku-5-5.json')
    criterion = 'The response gives the correct answer to the question. Only objective correctness counts: a correct answer beats a fluent wrong one.'
    items = [{'id': x['id'], 'group': x['group'], 'label': x['label'], 'question': x['question'], 'a': x['a'], 'b': x['b'],
              'criterion': criterion} for x in json.loads(pool_raw)]
    rec = {r['id']: r for r in json.loads(rec_raw)}
    recorded = {'driftbench': {i: {'games': r['ledgerGames']} for i, r in rec.items()},
                'promptfoo': {i: {'games': r['promptfooGames']} for i, r in rec.items()}}
    score = {c: sum(official(recorded[c][x['id']]['games'], x['label']) for x in items) for c in recorded}
    assert score == {'driftbench': 240, 'promptfoo': 224}, score
    return items, recorded, {'pool': ('examples/ledger-jb/data/pool.json', sha(pool_raw)),
                             'recorded': ('examples/ledger-jb/results/items-claude-haiku-5-5.json', sha(rec_raw))}, score


def mmeval(branch):
    pool_raw = show(branch, 'research/ledger-mm/artifacts/pool.json')
    rec_raw = show(branch, 'research/ledger-mm/recordings/decisions.jsonl')
    res_raw = show(branch, 'research/ledger-mm/test-results.json')
    criterion = "The response is the better reply to the user's request: correct, helpful and safe, and in the language the user wrote in."
    items = [{'id': x['id'], 'group': x['group'], 'label': x['label'], 'language': x['language'], 'question': x['question'],
              'a': x['a'], 'b': x['b'], 'criterion': criterion} for x in json.loads(pool_raw)]
    rows = [r for r in jsonl(rec_raw) if r['model'] == 'haiku' and r['phase'] == 'test']
    names = {'ledger': 'driftbench', 'promptfoo': 'promptfoo'}
    recorded = defaultdict(dict)
    for r in rows:
        assert r['id'] not in recorded[names[r['contestant']]], r['id']
        recorded[names[r['contestant']]][r['id']] = {'games': r['games'], 'graderError': bool(r.get('graderError'))}
    results = json.loads(res_raw)['models']['haiku']
    missing = sorted(results['missing']['ids'])
    return items, dict(recorded), {'pool': ('research/ledger-mm/artifacts/pool.json', sha(pool_raw)),
                                   'recorded': ('research/ledger-mm/recordings/decisions.jsonl', sha(rec_raw)),
                                   'results': ('research/ledger-mm/test-results.json', sha(res_raw))}, \
        {'primaryMissingIds': missing, 'primary': results['primary']['scores'], 'registeredAllIn': results['registeredAllIn']['scores']}


def rubricbench(branch, items_path):
    raw = Path(items_path).read_bytes()
    seal_raw = show(branch, 'examples/judge-benchmarks/experiments/ledger-rb/pool-seal.json')
    seal = json.loads(seal_raw)
    # The loader serialises with JSON.stringify, so the hash is over the compact form.
    assert sha(raw) == seal['normalizedTestPayloadSha256'], 'RubricBench payload differs from the seal'
    items = [{'id': x['id'], 'group': x['group'], 'label': x['label'], 'question': x['question'], 'a': x['a'], 'b': x['b'],
              'criterion': x['criterion']} for x in json.loads(raw)]
    files = [p for p in git('ls-tree', '-r', '--name-only', branch, 'examples/judge-benchmarks/experiments/ledger-rb/').decode().split()
             if p.split('/')[-1].startswith('decisions-test-')]
    last = {}
    hashes = {}
    for path in sorted(files):
        raw_rows = show(branch, path)
        hashes[path] = sha(raw_rows)
        for r in jsonl(raw_rows):
            if r['model'] == 'claude-haiku-5-5' and r['phase'] == 'test':
                last[(r['id'], r['contestant'])] = r
    names = {'pair-ledger': 'driftbench', 'promptfoo': 'promptfoo'}
    recorded = defaultdict(dict)
    for (i, c), r in last.items():
        if c in names:
            recorded[names[c]][i] = {'games': r['decisions'], 'status': r['status']}
    score = {c: sum(g == x['label'] for x in items for g in recorded[c].get(x['id'], {}).get('games', [])) for c in recorded}
    assert score == {'driftbench': 1306, 'promptfoo': 1194}, score
    return items, dict(recorded), {'seal': ('examples/judge-benchmarks/experiments/ledger-rb/pool-seal.json', sha(seal_raw)),
                                   'items': ('rebuilt by the branch loader from the cached Hugging Face rows', sha(raw)),
                                   'recorded': hashes}, score


def verify(branch):
    pool_raw = show(branch, 'examples/ledger-verify/evidence/pool.json')
    rec_raw = show(branch, 'examples/ledger-verify/results/haiku.strict.json')
    criterion = 'The final answer the response gives to the question is correct.'
    items = [{'id': x['id'], 'group': x['group'], 'label': x['correct'], 'question': x['question'], 'response': x['response'],
              'criterion': criterion} for x in json.loads(pool_raw)]
    rec = json.loads(rec_raw)
    names = {'driftbench-verify-uncertainty-cascade': 'driftbench', 'promptfoo': 'promptfoo'}
    recorded = {}
    for c in rec['contestants']:
        if c['contestant'] in names:
            recorded[names[c['contestant']]] = {d['id']: {'pass': d.get('pass'), 'missing': bool(d.get('missing'))} for d in c['decisions']}
    score = {c: sum(recorded[c].get(x['id'], {}).get('pass') == x['label'] for x in items) for c in recorded}
    assert score == {'driftbench': 164, 'promptfoo': 159}, score
    return items, recorded, {'pool': ('examples/ledger-verify/evidence/pool.json', sha(pool_raw)),
                             'recorded': ('examples/ledger-verify/results/haiku.strict.json', sha(rec_raw))}, score


def writing(branch):
    pool_raw = show(branch, 'examples/ledger-wp/seals/test.json')
    rec_raw = show(branch, 'examples/ledger-wp/results/decisions.jsonl')
    criterion = 'The response is the better piece of writing for the instruction: it follows every requirement of the instruction and is of higher quality.'
    pool = json.loads(pool_raw)
    pool = pool['items'] if isinstance(pool, dict) else pool
    items = [{'id': x['id'], 'group': x['language'], 'label': x['label'], 'requestId': x['requestId'], 'question': x['question'],
              'a': x['a'], 'b': x['b'], 'criterion': criterion} for x in pool]
    names = {'pair-ledger': 'driftbench', 'reader-first-c50b2dc3': 'driftbench-reader-first', 'promptfoo': 'promptfoo'}
    recorded = defaultdict(dict)
    for r in jsonl(rec_raw):
        if r['model'] == 'haiku' and r['split'] == 'test' and r['contestant'] in names and int(r['sample']) == 0:
            assert r['id'] not in recorded[names[r['contestant']]]
            recorded[names[r['contestant']]][r['id']] = {'games': r['games'], 'graderErrors': r.get('graderErrors', 0)}
    score = {c: sum(g == x['label'] for x in items for g in recorded[c][x['id']]['games']) for c in recorded}
    assert score == {'driftbench': 212, 'driftbench-reader-first': 234, 'promptfoo': 197}, score
    return items, dict(recorded), {'pool': ('examples/ledger-wp/seals/test.json', sha(pool_raw)),
                                   'recorded': ('examples/ledger-wp/results/decisions.jsonl', sha(rec_raw))}, score


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--rubricbench-items', required=True, help='JSON written by the ledger-rb loader (rbsrc/load.mts)')
    ap.add_argument('--items-only', action='store_true',
                    help='rebuild only data/<bench>/items.json from the pinned commit and check its sha256 (items are not committed)')
    args = ap.parse_args()
    sources = {
        'judgebench': ('origin/research/ledger-jb', judgebench),
        'mmeval': ('origin/research/ledger-mm', mmeval),
        'rubricbench': ('origin/research/ledger-rb', lambda b: rubricbench(b, args.rubricbench_items)),
        'verify': ('origin/research/ledger-verify', verify),
        'writing': ('origin/research/ledger-wp', writing),
    }
    for bench, (branch, load) in sources.items():
        out = ROOT / 'data' / bench
        if args.items_only:
            pinned = json.loads((out / 'provenance.json').read_text())
            items = load(pinned['commit'])[0]
            text = json.dumps(items, ensure_ascii=False, indent=1) + '\n'
            assert sha(text.encode()) == pinned['itemsSha256'], f'{bench}: items differ from the committed sha256'
            (out / 'items.json').write_text(text)
            print(bench, len(items), 'items match the committed sha256')
            continue
        commit = git('rev-parse', branch).decode().strip()
        items, recorded, files, check = load(commit)
        out.mkdir(parents=True, exist_ok=True)
        text = json.dumps(items, ensure_ascii=False, indent=1) + '\n'
        (out / 'items.json').write_text(text)
        (out / 'recorded.json').write_text(json.dumps(recorded, ensure_ascii=False, indent=1) + '\n')
        (out / 'provenance.json').write_text(json.dumps({'branch': branch, 'commit': commit, 'files': files,
                                                         'recordedCheck': check, 'items': len(items),
                                                         'itemsSha256': sha(text.encode())}, indent=1) + '\n')
        print(bench, len(items), {c: len(v) for c, v in recorded.items()}, check if bench != 'mmeval' else check['primary'])


if __name__ == '__main__':
    sys.exit(main())
