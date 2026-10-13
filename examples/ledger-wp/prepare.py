"""Seal writing pools without model calls or outcome-based selection."""
import collections
import hashlib
import json
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ESTATE = ROOT.parent
SEED = 'ledger-wp-2026-10-13-v1'

def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()

def canonical_pair(question, a, b):
    return sha(json.dumps([question, *sorted([a, b])], ensure_ascii=False, separators=(',', ':')))

def dump(name, value):
    out = HERE / name
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    return sha(out.read_bytes())

def requirements(question):
    patterns = {
        'length': r'\b\d+\s*(?:to\s*\d+\s*)?(?:words?|characters?|lines?|paragraphs?)\b|\d+\s*(?:字|行|段)',
        'language': r'\b(?:in|using|written in)\s+(?:English|Chinese|Mandarin|French|Spanish)\b|(?:用|使用)(?:中文|汉语|英文|英语)',
        'form': r'\b(?:write|create|compose|draft|produce)\s+(?:(?:a|an|the|short|brief|long|concise)\s+)*(?:poem|story|essay|speech|script|letter|memo|report|proposal|review|sonnet|haiku)\b|(?:写|创作|撰写).{0,12}(?:小说|诗歌|散文|剧本|演讲|书信)',
        'named_element': r'\b(?:must include|must mention|must feature|required to include|include the (?:name|character|phrase|word)|mention the (?:name|character|phrase|word))\b|(?:必须包含|必须包括|必须提及|务必包含)',
    }
    rows = []
    for kind, pattern in patterns.items():
        quotes = []
        for match in re.finditer(pattern, question, re.I):
            start = max(question.rfind('\n', 0, match.start()), question.rfind('. ', 0, match.start()), question.rfind('。', 0, match.start())) + 1
            ends = [n for token in ['\n', '. ', '。'] if (n := question.find(token, match.end())) >= 0]
            quote = question[start:min(ends) + 1 if ends else len(question)].strip()
            if quote and quote not in quotes:
                quotes.append(quote)
        if quotes:
            rows.append({'id': kind, 'hard': True, 'quotes': quotes,
                         'definition': 'Follow only the explicit ' + kind.replace('_', ' ') + ' constraint in these verbatim request excerpts. Do not invent a constraint: ' + json.dumps(quotes, ensure_ascii=False)})
    rows.append({'id': 'better_piece', 'hard': False, 'quotes': [],
                 'definition': 'Holistically evaluate the complete piece for the actual writing request and intended reader: fulfillment, developed content, coherence, effective genre and style. This is the primary quality row. Length alone is neither a merit nor a defect. Respect requested repetition, invention and form; do not impose an unrelated writing style.'})
    return rows

def sample(items, n, seed):
    groups = collections.defaultdict(list)
    for item in items:
        groups[item['language']].append(item)
    quotas = []
    for group, members in groups.items():
        exact = n * len(members) / len(items)
        quotas.append([group, sorted(members, key=lambda x: sha(seed + ':' + x['id'])), int(exact), exact % 1])
    for q in sorted(quotas, key=lambda x: (-x[3], x[0]))[:n - sum(q[2] for q in quotas)]:
        q[2] += 1
    return sorted([x for _, members, count, _ in quotas for x in members[:count]], key=lambda x: sha(seed + ':run:' + x['id']))

def main():
    recorded, scanned, missing, digests = set(), [], [], set()
    names = ['opus-council', 'codex-jb', 'codex-mm', 'codex-rb', 'codex-verify', 'codex-wp', 'judge-benchmarks', 'astra-hard', 'opus-wp']
    for name in names:
        tree = ESTATE / name
        if not tree.exists():
            missing.append(name)
            continue
        for file in sorted((tree / 'examples').glob('*/recordings/**/*.jsonl')):
            blob = file.read_bytes()
            digest = sha(blob)
            count = 0
            if digest not in digests:
                for line in blob.splitlines():
                    if not line.strip():
                        continue
                    row = json.loads(line)
                    for key in ['item', 'itemId', 'pair_id', 'prompt_id']:
                        if row.get(key) is not None:
                            recorded.add(str(row[key]))
                    count += 1
                digests.add(digest)
            scanned.append({'path': str(file), 'sha256': digest, 'parsedRows': count, 'duplicateFile': count == 0})
    longjudge = [json.loads(line) for line in (HERE / 'sources/longjudge-wp.jsonl').read_text().splitlines() if line]
    old_pairs = {canonical_pair(x['instruction'], x['responses'][0]['content'], x['responses'][1]['content']) for x in longjudge}
    old_ids = {x['id'] for x in longjudge}
    old_questions = {sha(x['instruction']) for x in longjudge}
    eligible, all_rows, excluded = [], [], collections.Counter()
    invalid = []
    seen = set()
    for file in sorted((HERE / 'sources').glob('WP*.json')):
        language = 'zh' if 'chinese' in file.name else 'en'
        for index, raw in enumerate(json.loads(file.read_text())):
            question, chosen, rejected = raw['prompt'], raw['chosen']['response'], raw['rejected']['response']
            pair_id = canonical_pair(question, chosen, rejected)
            chosen_first = int(sha(SEED + ':order:' + pair_id)[:2], 16) % 2 == 0
            row = {'id': pair_id, 'requestId': raw['prompt_id'], 'question': question,
                   'a': chosen if chosen_first else rejected, 'b': rejected if chosen_first else chosen,
                   'label': 'A' if chosen_first else 'B', 'language': language, 'tag': raw['tag'],
                   'sourceFile': file.name, 'sourceIndex': index,
                   'candidateModels': {'A': raw['chosen' if chosen_first else 'rejected']['model'], 'B': raw['rejected' if chosen_first else 'chosen']['model']},
                   'sourceScores': [raw['chosen']['score'], raw['rejected']['score']],
                   'requirements': requirements(question)}
            all_rows.append(row)
            reasons = []
            if raw['chosen']['score'] <= raw['rejected']['score']:
                reasons.append('non_strict_preference'); invalid.append({'id': pair_id, 'sourceFile': file.name, 'sourceIndex': index, 'scores': row['sourceScores']})
            if pair_id in old_pairs: reasons.append('exact_longjudge_pair')
            if raw['prompt_id'] in old_ids or sha(question) in old_questions: reasons.append('longjudge_request_overlap')
            if raw['prompt_id'] in recorded or pair_id in recorded: reasons.append('recorded_id_overlap')
            if pair_id in seen: reasons.append('duplicate_pair')
            seen.add(pair_id)
            if reasons:
                excluded.update(reasons)
            else:
                eligible.append(row)
    if len(eligible) < 173:
        raise RuntimeError('Fresh pool smaller than preregistered minimum; inspect before any fallback')
    test = sample(eligible, 173, SEED + ':test')
    dev_candidates = []
    for raw in longjudge:
        if hashlib.sha256(f"split:longjudge-wp:{raw['id']}".encode()).digest()[0] >= 77:
            continue
        a, b = [r['content'] for r in raw['responses']]
        dev_candidates.append({'id': canonical_pair(raw['instruction'], a, b), 'requestId': raw['id'], 'question': raw['instruction'],
                               'a': a, 'b': b, 'label': 'A' if raw['responses'][0]['model'] == raw['ground_truth']['chosen']['model'] else 'B',
                               'language': raw['meta']['language'], 'tag': raw['meta']['tag'], 'requirements': requirements(raw['instruction'])})
    pilot = sample(dev_candidates, 20, SEED + ':pilot')
    pilot_requests = {x['requestId'] for x in pilot}
    dev_rest = [x for x in dev_candidates if x['requestId'] not in pilot_requests]
    dev = sample(dev_rest, 30, SEED + ':dev')
    hashes = {split: dump('seals/' + split + '.json', rows) for split, rows in [('pilot', pilot), ('dev', dev), ('test', test)]}
    dump('seals/recorded-id-union.json', sorted(recorded))
    dump('seals/recording-inventory.json', {'scanned': scanned, 'missingWorktrees': missing, 'rule': 'Missing trees are explicitly unverified; all LongJudge request IDs and question hashes excluded conservatively.'})
    summary = {'seed': SEED, 'sourcePairs': len(all_rows), 'longjudgePairs': len(longjudge), 'longjudgeRequests': len(old_ids),
               'eligibleFreshPairs': len(eligible), 'eligibleRequests': len({x['requestId'] for x in eligible}),
               'exclusionCountsOverlap': dict(excluded), 'invalidLabels': invalid, 'recordedIds': len(recorded), 'scannedFiles': len(scanned),
               'missingWorktrees': missing, 'hashes': hashes,
               'splits': {k: {'pairs': len(v), 'games': 2*len(v), 'requests': len({x['requestId'] for x in v}), 'languages': dict(collections.Counter(x['language'] for x in v))} for k,v in [('pilot',pilot),('dev',dev),('test',test)]},
               'selection': '173 fresh pairs, proportional language allocation, SHA-256 rank without inspecting contestant outcomes. Entire LongJudge requests excluded. Pilot and dev previously exposed, request-disjoint from one another and test.',
               'noveltyLimit': 'No benchmark recording ID overlap in the enumerated available trees. This does not prove absence from model pretraining or inaccessible recordings.'}
    dump('seals/manifest.json', summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))

if __name__ == '__main__': main()
