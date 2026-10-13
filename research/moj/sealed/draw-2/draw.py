"""Second sealed draw. Ids and digests only (step `ids`), then the pair files (step `build`). No model call.

MM-Eval (confirmatory cell): 600 never-scored ids, disjoint from practice, from the first sealed run and from every id
any run scored, one pair per prompt group.
JudgeBench and writing (secondary cells, outside the test family): pairs unseen by MoJ but previously scored by the
ledger harness, whose after-the-fact analysis informed the MoJ design. JudgeBench: the Claude-response pairs whose
prompt is not in MoJ practice or the first sealed run. Writing: the never-scored pairs left that are prompt-disjoint
(44 expected) plus the ledger harness's sealed TEST pairs (173 expected).
"""
import hashlib, importlib.util, json, os, sys, tempfile
HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(HERE, 'sealed', 'draw-2')
W = '/Users/assem/Documents/GitHub/driftbench/.worktrees'
sha = lambda t: hashlib.sha256(t.encode()).hexdigest()
fold = lambda t: sha(' '.join(str(t).split()))
used_q = {b: {fold(x['question']) for f in (f'data/{b}.json', f'sealed/{b}.json') for x in json.load(open(os.path.join(HERE, f)))} for b in ('judgebench', 'mmeval', 'writing')}
used_id = {b: {str(x['id']) for f in (f'data/{b}.json', f'sealed/{b}.json') for x in json.load(open(os.path.join(HERE, f)))} for b in used_q}

def judgebench():
    rows = [json.loads(l) for l in open(f'{W}/ledger-jb/examples/ledger-jb/data/claude.jsonl')]
    return [{'id': r['pair_id'], 'group': r['source'].split('-')[0], 'language': 'en', 'question': r['question'], 'a': r['response_A'], 'b': r['response_B'],
             'label': 'A' if r['label'] == 'A>B' else 'B'} for r in rows if r['label'] in ('A>B', 'B>A') and fold(r['question']) not in used_q['judgebench']]

def mmeval():
    cache = os.path.join(tempfile.gettempdir(), 'driftbench-judge-benchmarks')
    raw = []
    for offset in range(0, 10000, 100):
        url = f'https://datasets-server.huggingface.co/rows?dataset=prometheus-eval/MM-Eval&config=default&split=test&offset={offset}&length=100'
        page = json.load(open(os.path.join(cache, sha(url)[:16])))
        raw += page['rows']
        if offset + 100 >= page['num_rows_total']:
            break
    pool = {str(x['id']) for x in json.load(open(f'{W}/ledger-mm/research/ledger-mm/artifacts/pool.json'))}
    scored = set(map(str, json.load(open(f'{W}/ledger-mm/research/ledger-mm/artifacts/excluded-ids.json'))))
    seal1 = set(json.load(open(os.path.join(HERE, 'data/sealed-confirmation.json')))['mmeval']['ids'])
    split = lambda i: 'dev' if bytes.fromhex(sha('split:mmeval:' + i))[0] < 77 else 'test'
    out, groups = [], set(used_q['mmeval'])
    rows = sorted(raw, key=lambda v: sha('moj-confirm-v2:' + str(v['row_idx'])))
    for value in rows:
        row, i = value['row'], str(value['row_idx'])
        if row['subset'] not in {'chat', 'reasoning', 'safety', 'linguistics', 'language mixing'} or split(i) != 'test': continue
        if i in pool or i in scored or i in seal1 or i in used_id['mmeval']: continue
        g = fold(row['prompt'])
        if g in groups: continue  # one pair per prompt group, and none shared with practice or the first sealed run
        groups.add(g)
        first = bytes.fromhex(sha('mmeval:' + i))[0] % 2 == 0
        out.append({'id': i, 'group': row['subset'], 'language': row['language'], 'question': row['prompt'],
                    'a': row['chosen'] if first else row['rejected'], 'b': row['rejected'] if first else row['chosen'], 'label': 'A' if first else 'B'})
        if len(out) == 600: break
    return out

def writing():
    wp = f'{W}/ledger-wp/examples/ledger-wp'
    spec = importlib.util.spec_from_file_location('wpprep', f'{wp}/prepare.py'); mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    test = json.load(open(f'{wp}/seals/test.json'))
    out = [{'id': x['id'], 'requestId': x['requestId'], 'question': x['question'], 'a': x['a'], 'b': x['b'], 'label': x['label'], 'language': x['language'],
            'group': x.get('tag', ''), 'requirements': x['requirements'], 'origin': 'ledger-test'} for x in test if fold(x['question']) not in used_q['writing']]
    tid, treq = {x['id'] for x in test}, {x['requestId'] for x in test}
    rec = set(json.load(open(f'{wp}/seals/recorded-id-union.json')))
    long = [json.loads(l) for l in open(f'{wp}/sources/longjudge-wp.jsonl') if l.strip()]
    lreq, lq = {x['id'] for x in long}, {sha(x['instruction']) for x in long}
    for name in sorted(os.listdir(f'{wp}/sources')):
        if not (name.startswith('WP') and name.endswith('.json')): continue
        language = 'zh' if 'chinese' in name else 'en'
        for raw in json.load(open(f'{wp}/sources/{name}')):
            q, c, r = raw['prompt'], raw['chosen']['response'], raw['rejected']['response']
            pid = sha(json.dumps([q, *sorted([c, r])], ensure_ascii=False, separators=(',', ':')))
            if raw['chosen']['score'] <= raw['rejected']['score'] or pid in tid or raw['prompt_id'] in treq or pid in rec or raw['prompt_id'] in rec or raw['prompt_id'] in lreq or sha(q) in lq: continue
            if pid in used_id['writing'] or fold(q) in used_q['writing']: continue
            first = int(sha('moj-order-v1:' + pid)[:2], 16) % 2 == 0
            out.append({'id': pid, 'requestId': raw['prompt_id'], 'question': q, 'a': c if first else r, 'b': r if first else c, 'label': 'A' if first else 'B',
                        'language': language, 'group': raw['tag'], 'requirements': mod.requirements(q), 'origin': 'never-scored'})
    return out

sets = {'judgebench': judgebench(), 'mmeval': mmeval(), 'writing': writing()}
if sys.argv[1] == 'ids':
    seal = {b: {'ids': [str(x['id']) for x in items], 'count': len(items), 'prompt_groups': len({fold(x['question']) for x in items}),
                'sha256': sha(json.dumps([str(x['id']) for x in items]))} for b, items in sets.items()}
    seal['writing']['origins'] = {o: sum(1 for x in sets['writing'] if x['origin'] == o) for o in ('never-scored', 'ledger-test')}
    json.dump(seal, open(os.path.join(OUT, 'sealed-ids.json'), 'w'), indent=1)
    print({b: (e['count'], e['prompt_groups'], e['sha256'][:12]) for b, e in seal.items()}, seal['writing']['origins'])
else:
    seal = json.load(open(os.path.join(OUT, 'sealed-ids.json')))
    for b, items in sets.items():
        assert [str(x['id']) for x in items] == seal[b]['ids'], b
        for x in items:
            x['split'] = 'sealed-2'; x['set'] = 'sealed-2'; x['baselines'] = {}
        json.dump(items, open(os.path.join(OUT, f'{b}.json'), 'w'), ensure_ascii=False)
    # input of the ledger baseline run: the pairs with no recorded ledger answer (all of MM-Eval, the never-scored writing pairs)
    os.makedirs(os.path.join(OUT, 'ledger-input'), exist_ok=True)
    json.dump(sets['mmeval'], open(os.path.join(OUT, 'ledger-input', 'mmeval.json'), 'w'), ensure_ascii=False)
    json.dump([x for x in sets['writing'] if x['origin'] == 'never-scored'], open(os.path.join(OUT, 'ledger-input', 'writing.json'), 'w'), ensure_ascii=False)
    print('built', {b: len(v) for b, v in sets.items()})
