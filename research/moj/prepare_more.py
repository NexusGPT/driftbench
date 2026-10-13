"""Enlarges the practice sets to about 300 pairs each and seals fresh confirmation ids.

Sources are practice or DEV data only. No sealed TEST pool is read for texts:
  JudgeBench  the GPT-4o response split (350 pairs). The sealed pool is the Claude split: only its ids are not used at all.
  MM-Eval     the exposed DEV400 sample.
  Writing     the exposed LongJudge DEV slice (never its earlier TEST slice), then pairs of the source files that no run ever scored
              (not in the sealed TEST of the ledger harness, not in its recorded-id union, request-disjoint from that TEST).
The first 168 pairs stay as the fixed subset `core` (item field `set`); new pairs have `set: "ext"`.
Confirmation ids are drawn by hash from what is left, written to data/sealed-confirmation.json with a digest,
and never scored here.
"""
import hashlib, json, os, sys
W = sys.argv[1] if len(sys.argv) > 1 else '/Users/assem/Documents/GitHub/driftbench/.worktrees'
DEV400 = sys.argv[2] if len(sys.argv) > 2 else '/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/opus/dev400.json'
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda text: hashlib.sha256(text.encode()).hexdigest()
rank = lambda salt: (lambda item: sha(f'moj-practice-v1:{salt}:{item["id"]}'))
sealed = {}

def save(bench, core, extra, target):
    seen = {str(x['id']) for x in core}
    for x in core: x['set'] = 'core'
    extra = [x for x in sorted(extra, key=rank(bench)) if str(x['id']) not in seen]
    take = extra[:max(0, target - len(core))]
    for x in take: x['set'] = 'ext'; x.setdefault('baselines', {}); x.setdefault('split', 'practice-ext')
    json.dump(core + take, open(f'{HERE}/data/{bench}.json', 'w'), ensure_ascii=False)
    print(bench, 'core', len(core), 'ext', len(take), 'left', len(extra) - len(take))
    return extra[len(take):]

def unique(items):
    out, seen = [], set()
    for x in items:
        if str(x['id']) not in seen:
            seen.add(str(x['id'])); out.append(x)
    return out

# JudgeBench
core = unique(json.load(open(f'{HERE}/data/judgebench.json')))
core = [x for x in core if x.get('set', 'core') == 'core']
rows = [json.loads(line) for line in open(f'{W}/ledger-jb/examples/ledger-jb/data/gpt.jsonl')]
extra = [{'id': r['pair_id'], 'group': r['source'].split('-')[0], 'language': 'en', 'question': r['question'],
          'a': r['response_A'], 'b': r['response_B'], 'label': 'A' if r['label'] == 'A>B' else 'B'} for r in rows if r['label'] in ('A>B', 'B>A')]
left = save('judgebench', core, extra, 250)
fold = lambda text: sha(' '.join(str(text).split()))
practice_questions = {fold(x['question']) for x in json.load(open(f'{HERE}/data/judgebench.json'))}
left = [x for x in left if fold(x['question']) not in practice_questions]  # a question is practice or confirmation, never both
sealed['judgebench'] = {'source': 'ScalerLab/JudgeBench, GPT-4o response split, pairs left after the practice draw', 'ids': [x['id'] for x in left]}

# MM-Eval
core = [x for x in unique(json.load(open(f'{HERE}/data/mmeval.json'))) if x.get('set', 'core') == 'core']
extra = [{'id': str(r['id']), 'group': r['group'], 'language': r['language'], 'question': r['question'], 'a': r['a'], 'b': r['b'], 'label': r['label']}
         for r in json.load(open(DEV400)) if r['label'] in ('A', 'B')]
save('mmeval', core, extra, 300)
sealed['mmeval'] = {'source': 'MM-Eval items never scored by any run: the eligible TEST population of the ledger-mm seal minus its 600-pair pool',
                    'ids': None, 'rule': 'draw 300 by sha256("moj-confirm-v1:" + id) rank, 60 per subset, from ids absent from ledger-mm artifacts/excluded-ids.json and artifacts/pool.json'}

# Writing
wp = f'{W}/ledger-wp/examples/ledger-wp'
core = [x for x in unique(json.load(open(f'{HERE}/data/writing.json'))) if x.get('set', 'core') == 'core']
canonical = lambda q, a, b: sha(json.dumps([q, *sorted([a, b])], ensure_ascii=False, separators=(',', ':')))
test = json.load(open(f'{wp}/seals/test.json'))
test_ids, test_requests = {x['id'] for x in test}, {x['requestId'] for x in test}
recorded = set(json.load(open(f'{wp}/seals/recorded-id-union.json')))
long = [json.loads(line) for line in open(f'{wp}/sources/longjudge-wp.jsonl') if line.strip()]
long_requests = {x['id'] for x in long}
long_questions = {sha(x['instruction']) for x in long}
dev = []
for raw in long:
    # The ledger harness keeps only this hash slice of LongJudge as DEV; the rest was a scored TEST of an earlier run.
    if hashlib.sha256(f"split:longjudge-wp:{raw['id']}".encode()).digest()[0] >= 77:
        continue
    a, b = [r['content'] for r in raw['responses']]
    dev.append({'id': canonical(raw['instruction'], a, b), 'requestId': raw['id'], 'question': raw['instruction'], 'a': a, 'b': b,
                'label': 'A' if raw['responses'][0]['model'] == raw['ground_truth']['chosen']['model'] else 'B',
                'language': raw['meta']['language'], 'group': raw['meta']['tag'], 'split': 'longjudge-dev'})
fresh = []
for name in sorted(os.listdir(f'{wp}/sources')):
    if not (name.startswith('WP') and name.endswith('.json')): continue
    language = 'zh' if 'chinese' in name else 'en'
    for raw in json.load(open(f'{wp}/sources/{name}')):
        q, chosen, rejected = raw['prompt'], raw['chosen']['response'], raw['rejected']['response']
        pid = canonical(q, chosen, rejected)
        if raw['chosen']['score'] <= raw['rejected']['score'] or pid in test_ids or raw['prompt_id'] in test_requests: continue
        if pid in recorded or raw['prompt_id'] in recorded or raw['prompt_id'] in long_requests or sha(q) in long_questions: continue
        first = int(sha('moj-order-v1:' + pid)[:2], 16) % 2 == 0
        fresh.append({'id': pid, 'requestId': raw['prompt_id'], 'question': q, 'a': chosen if first else rejected, 'b': rejected if first else chosen,
                      'label': 'A' if first else 'B', 'language': language, 'group': raw['tag'], 'split': 'never-scored'})
fresh = unique(fresh)
# requests are split first: a request is either practice or confirmation, never both
requests = sorted({x['requestId'] for x in fresh}, key=lambda r: sha('moj-request-v1:' + r))
practice_requests = set(requests[:len(requests) // 2])
practice_fresh = [x for x in fresh if x['requestId'] in practice_requests]
confirm_fresh = [x for x in fresh if x['requestId'] not in practice_requests]
seen = {x['id'] for x in core}
dev = [x for x in unique(dev) if x['id'] not in seen]
for x in dev: x['set'] = 'ext'; x['baselines'] = {}
for x in core: x['set'] = 'core'
need = 300 - len(core) - len(dev)
take = sorted(practice_fresh, key=rank('writing'))[:max(0, need)]
for x in take: x['set'] = 'ext'; x['baselines'] = {}
json.dump(core + dev + take, open(f'{HERE}/data/writing.json', 'w'), ensure_ascii=False)
print('writing core', len(core), 'longjudge dev', len(dev), 'never-scored', len(take), 'confirmation candidates', len(confirm_fresh))
sealed['writing'] = {'source': 'WritingPreferenceBench source pairs never scored by any run, request-disjoint from practice and from the ledger TEST',
                     'ids': [x['id'] for x in sorted(confirm_fresh, key=lambda x: sha('moj-confirm-v1:' + x['id']))[:300]]}
sealed['judgebench']['ids'] = sorted(sealed['judgebench']['ids'], key=lambda i: sha('moj-confirm-v1:' + i))
for bench, entry in sealed.items():
    if entry['ids'] is not None:
        entry['count'] = len(entry['ids']); entry['sha256'] = sha(json.dumps(entry['ids']))
json.dump(sealed, open(f'{HERE}/data/sealed-confirmation.json', 'w'), indent=1)
print({b: (e.get('count'), (e.get('sha256') or '')[:16]) for b, e in sealed.items()})
