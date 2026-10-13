"""Builds data/rubricbench.json, data/verify.json and data/hardrows.json for the pointwise adapter.

Reads other worktrees only (never writes there). Practice material only:
  rubricbench  DEV pairs of the ledger-rb harness that carry a recorded decision (pilot, noise, fixtures).
               A row whose id is not in that DEV list is skipped before any of its fields is read.
  verify       the 95 DEV answers of the ledger-verify harness (evidence/dev.json). The sealed pool is never opened.
  hardrows     the reported tuning sets of the rubric and factuality hard rows (comparisons/promptfoo/hard).
               The held-out sets and the fresh sealed cohort are never opened.
Shape: the pair shape of the README. A point item is "the output" (a) against "an empty reference" (b = ""),
label "A" for pass and "B" for fail, kind "point". `reference` is present only where the source gives one (the
factuality hard rows); the verify rows carry none. `split_group` is a hash of the shared reference, criterion or
question: the tuning and validation halves are cut on it. A baseline game is "A" (pass), "B" (fail) or a word that
scores zero ("inconclusive", "missing"), as the source study scores it.
"""
import collections
import hashlib
import json
import os
import sys

W = sys.argv[1] if len(sys.argv) > 1 else '/Users/assem/Documents/GitHub/driftbench/.worktrees'
HERE = os.path.dirname(os.path.abspath(__file__))


def lines(path):
    with open(path) as handle:
        return [json.loads(line) for line in handle if line.strip()]


def rank(seed, value):
    return hashlib.sha256(f'{seed}:{value}'.encode()).hexdigest()


def dump(name, rows):
    # split_group: items that share a prompt, a source or a reference carry the same value and land in the same half.
    for row in rows:
        shared = row.get('reference') or row.get('rubric') or row['question']
        row['split_group'] = name + ':' + hashlib.sha256(shared.encode()).hexdigest()[:16]
    json.dump(rows, open(os.path.join(HERE, 'data', name + '.json'), 'w'), ensure_ascii=False)
    print(name, len(rows), dict(collections.Counter((r['split'], r['label'], tuple(sorted(r['baselines']))) for r in rows)))


def rubricbench(limit=100):
    rb = f'{W}/ledger-rb/examples/judge-benchmarks/experiments/ledger-rb'
    plan = json.load(open(f'{rb}/development-plan.json'))
    requirements = {r['id']: r for r in json.load(open(f'{rb}/requirements.json')) if r['split'] == 'dev'}
    phase_of, base = {}, {}
    for phase in ('pilot', 'noise', 'fixtures'):
        for row in lines(f'{rb}/decisions-{phase}-000.jsonl'):
            if row['model'] != 'gpt-6-luna' or row.get('sample', 0) != 0 or row['id'] not in requirements:
                continue
            phase_of.setdefault(row['id'], phase)
            name = {'pair-ledger': 'ledger', 'promptfoo': 'promptfoo', 'seat': 'seat'}[row['contestant']]
            base.setdefault(row['id'], {}).setdefault(name, {'games': row['decisions'], 'calls': len(row.get('callKeys') or []),
                                                             'status': row['status'], 'model': 'gpt-6-luna', 'phase': phase})
    assert set(plan['pilotIds']) <= set(phase_of) and set(plan['noiseIds']) <= set(phase_of)
    repeats = collections.defaultdict(dict)  # the three recorded repeats of our judge on the noise items
    for row in lines(f'{rb}/decisions-noise-000.jsonl'):
        if row['model'] == 'gpt-6-luna' and row['contestant'] == 'pair-ledger' and row['id'] in base:
            repeats[row['id']][row.get('sample', 0)] = row['decisions']
    for item_id, by_sample in repeats.items():
        if 'ledger' in base[item_id] and len(by_sample) == 3:
            base[item_id]['ledger']['repeats'] = [by_sample[k] for k in sorted(by_sample)]
    order = {'pilot': 0, 'noise': 1, 'fixtures': 2}
    chosen = sorted(phase_of, key=lambda i: (order[phase_of[i]], rank('moj-rb-v1', i)))[:limit]
    wanted, out = set(chosen), {}
    cache = f'{W}/ledger-rb/.cache/ledger-rb/data'
    for name in sorted(os.listdir(cache)):
        try:
            page = json.load(open(os.path.join(cache, name)))
        except ValueError:
            continue
        for entry in page.get('rows', []) if isinstance(page, dict) else []:
            row = entry['row']
            if row.get('case_id') not in wanted:  # anything outside the chosen DEV ids is skipped unread
                continue
            # the split hash of the ledger harness: first digest byte under 77 is DEV
            assert hashlib.sha256(f"split:rubricbench:{row['case_id']}".encode()).digest()[0] < 77
            out[row['case_id']] = {
                'id': row['case_id'], 'split': phase_of[row['case_id']], 'group': row['domain'], 'language': 'en', 'kind': 'pair',
                'question': row['instruction'], 'a': row['response_a'], 'b': row['response_b'],
                'label': 'A' if row['label'] == 0 else 'B',
                'rows': [[r['name'], r['rubric']] for r in requirements[row['case_id']]['requirements']],
                'baselines': base[row['case_id']]}
    assert len(out) == len(chosen), (len(out), len(chosen))
    dump('rubricbench', [out[i] for i in chosen])


def verify():
    root = f'{W}/ledger-verify/examples/ledger-verify'
    dev = sorted(json.load(open(f'{root}/evidence/dev.json')), key=lambda r: r['id'])
    names = {'driftbench-verify-uncertainty-cascade': 'ledger', 'promptfoo': 'promptfoo'}
    base = {}
    for phase in ('pilot', 'noise-0'):  # the pilot run first, then the first noise repeat for the ten items the pilot lacks
        report = json.load(open(f'{root}/{phase}/gpt-6-luna.json'))
        for contestant in report['contestants']:
            n = len(contestant['decisions'])
            for row in contestant['decisions']:
                game = 'missing' if row.get('pass') is None else 'A' if row['pass'] else 'B'
                base.setdefault(row['id'], {}).setdefault(names[contestant['contestant']], {
                    'games': [game], 'calls': round(contestant['calls'] / n, 2), 'costUsd': round(contestant['costUsd'] / n, 6),
                    'model': 'gpt-6-luna', 'phase': phase, 'cost_note': 'phase mean per item'})
    repeats = collections.defaultdict(lambda: collections.defaultdict(list))  # the recorded noise repeats, where all three exist
    for phase in ('noise-0', 'noise-1', 'noise-2'):
        path = f'{root}/{phase}/gpt-6-luna.json'
        if not os.path.exists(path):
            continue
        for contestant in json.load(open(path))['contestants']:
            for row in contestant['decisions']:
                repeats[row['id']][names[contestant['contestant']]].append(['missing' if row.get('pass') is None else 'A' if row['pass'] else 'B'])
    for item_id, by_name in repeats.items():
        for name, games in by_name.items():
            if name in base.get(item_id, {}) and len(games) == 3:
                base[item_id][name]['repeats'] = games
    out = []
    for index, item in enumerate(dev):
        out.append({'id': item['id'], 'split': 'pilot' if index < 20 else 'noise' if index < 30 else 'dev', 'group': item['group'],
                    'language': 'en', 'kind': 'point', 'row': 'verify', 'question': item['question'], 'a': item['response'], 'b': '',
                    'label': 'A' if item['correct'] else 'B', 'baselines': base.get(item['id'], {})})
    dump('verify', out)


def hardrows(per_cell=2):
    hard = f'{W}/ledger-hard/comparisons/promptfoo/hard'
    out = []
    for row in ('rubric', 'factuality'):
        cases = json.load(open(f'{hard}/{row}.json'))
        base = {}
        for side, name in (('audit', 'ledger'), ('shipped', 'shipped'), ('peer', 'promptfoo')):
            for rec in json.load(open(f'{hard}/recorded/{row}-{side}.json'))['rows']:
                game = {'pass': 'A', 'fail': 'B'}.get(rec['outcome'], 'inconclusive')
                base.setdefault(rec['id'], {})[name] = {'games': [game], 'calls': 1, 'costUsd': rec['call_cost'], 'model': 'claude-haiku-5-5'}
        cells = collections.defaultdict(list)
        for case in cases:
            cells[(case['kind'], case['truth'])].append(case)
        for (kind, truth), members in sorted(cells.items()):
            for case in sorted(members, key=lambda c: rank('moj-hard-v1', c['id']))[:per_cell]:
                item = {'id': case['id'], 'split': 'tuning', 'group': f'{row}/{kind}', 'language': 'fr' if kind == 'cross-language' else 'en',
                        'kind': 'point', 'row': row, 'question': case['question'], 'a': case['reply'], 'b': '',
                        'label': 'A' if truth else 'B', 'baselines': base[case['id']]}
                item['rubric' if row == 'rubric' else 'reference'] = case[row if row == 'rubric' else 'reference']
                out.append(item)
    dump('hardrows', out)


if __name__ == '__main__':
    rubricbench()
    verify()
    hardrows()
