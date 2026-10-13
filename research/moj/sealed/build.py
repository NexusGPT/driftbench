"""Builds the sealed confirmation pairs from data/sealed-confirmation.json (ids and digests frozen earlier).

Checks every digest, drops any id whose prompt also appears in practice (none expected), and writes
sealed/<bench>.json in the practice-file shape (no baselines). Nothing here calls a model.
"""
import hashlib, importlib.util, json, os, sys
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W = '/Users/assem/Documents/GitHub/driftbench/.worktrees'
sha = lambda t: hashlib.sha256(t.encode()).hexdigest()
fold = lambda t: sha(' '.join(str(t).split()))
seal = json.load(open(f'{HERE}/data/sealed-confirmation.json'))
for bench, e in seal.items():
    if isinstance(e, dict) and e.get('ids') is not None:
        assert sha(json.dumps(e['ids'])) == e['sha256'], bench
practice_q = {b: {fold(x['question']) for x in json.load(open(f'{HERE}/data/{b}.json'))} for b in ('judgebench', 'mmeval', 'writing')}
out, report = {}, {}
rows = {json.loads(l)['pair_id']: json.loads(l) for l in open(f'{W}/ledger-jb/examples/ledger-jb/data/gpt.jsonl')}
out['judgebench'] = [{'id': i, 'group': rows[i]['source'].split('-')[0], 'language': 'en', 'question': rows[i]['question'],
                      'a': rows[i]['response_A'], 'b': rows[i]['response_B'], 'label': 'A' if rows[i]['label'] == 'A>B' else 'B'}
                     for i in seal['judgebench']['ids']]
cache = os.path.join(__import__('tempfile').gettempdir(), 'driftbench-judge-benchmarks')
raw = []
for offset in range(0, 10000, 100):
    url = f'https://datasets-server.huggingface.co/rows?dataset=prometheus-eval/MM-Eval&config=default&split=test&offset={offset}&length=100'
    page = json.load(open(os.path.join(cache, sha(url)[:16])))
    raw += page['rows']
    if offset + 100 >= page['num_rows_total']:
        break
mm = {}
for value in raw:
    row, i = value['row'], str(value['row_idx'])
    first = bytes.fromhex(sha('mmeval:' + i))[0] % 2 == 0
    mm[i] = {'id': i, 'group': row['subset'], 'language': row['language'], 'question': row['prompt'],
             'a': row['chosen'] if first else row['rejected'], 'b': row['rejected'] if first else row['chosen'], 'label': 'A' if first else 'B'}
GROUPS = {'chat', 'reasoning', 'safety', 'linguistics', 'language mixing'}
out['mmeval'] = [mm[i] for i in seal['mmeval']['ids'] if i in mm and mm[i]['group'] in GROUPS]
report['mmeval_dropped_not_core'] = [i for i in seal['mmeval']['ids'] if i not in mm or mm[i]['group'] not in GROUPS]
spec = importlib.util.spec_from_file_location('wpprep', f'{W}/ledger-wp/examples/ledger-wp/prepare.py')
wp = importlib.util.module_from_spec(spec); spec.loader.exec_module(wp)
src = {}
for name in sorted(os.listdir(f'{W}/ledger-wp/examples/ledger-wp/sources')):
    if name.startswith('WP') and name.endswith('.json'):
        language = 'zh' if 'chinese' in name else 'en'
        for raw_row in json.load(open(f'{W}/ledger-wp/examples/ledger-wp/sources/{name}')):
            q, c, r = raw_row['prompt'], raw_row['chosen']['response'], raw_row['rejected']['response']
            pid = sha(json.dumps([q, *sorted([c, r])], ensure_ascii=False, separators=(',', ':')))
            first = int(sha('moj-order-v1:' + pid)[:2], 16) % 2 == 0
            src[pid] = {'id': pid, 'requestId': raw_row['prompt_id'], 'question': q, 'a': c if first else r, 'b': r if first else c,
                        'label': 'A' if first else 'B', 'language': language, 'group': raw_row['tag'], 'requirements': wp.requirements(q)}
out['writing'] = [src[i] for i in seal['writing']['ids']]
for bench, items in out.items():
    before = len(items)
    items[:] = [x for x in items if fold(x['question']) not in practice_q[bench]]
    report[bench] = {'sealed_ids': before, 'prompt_overlap_dropped': before - len(items), 'pairs': len(items)}
    for x in items:
        x['split'] = 'sealed'; x['set'] = 'sealed'; x['baselines'] = {}
    json.dump(items, open(f'{HERE}/sealed/{bench}.json', 'w'), ensure_ascii=False)
json.dump(report, open(f'{HERE}/sealed/build-report.json', 'w'), indent=1)
print(json.dumps({k: v for k, v in report.items() if k != 'mmeval_dropped_not_core'}), 'mm not core:', len(report['mmeval_dropped_not_core']))
