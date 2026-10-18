"""Build future VerifyBench-Hard pools with whole normalized-question groups.

Exclude all LongJudgeBench question IDs and normalized question texts. Seeded hashes order question
groups, with whole groups assigned to practice until its item target is met (it may exceed 120).
Normalization is Unicode NFC plus collapsed whitespace; case and mathematical symbols are preserved.

The historical data/manifest.json is frozen, including its defective item-ID split. --check restores
its pinned item files and checks their hashes, without changing membership or claiming disjointness.
New grouped pools go to data/grouped/ by default, never over the frozen data files or manifest.
"""
import argparse
import hashlib
import json
import sys
import urllib.request
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
SOURCES = {
    'verifybench-hard': ('https://huggingface.co/datasets/ZJU-REAL/VerifyBench/resolve/'
                         '05017ea8e105ec161dd562108d1f24e000050bac/verify_bench_hard.jsonl',
                         '1b405149e8e7307dc04e2b35dc1fcceec371ab8e7c68af9f74e5918503c0298d'),
    'longjudge-verify': ('https://raw.githubusercontent.com/cjj826/LongJudgeBench/'
                         '18b17211/data_standardized/verify_bench_hard.jsonl',
                         '92f7a99e91ee8067d5397042e2104b0e82deaa81fcffcb66a70eac614f7c20af'),
}
SEED = 'claude-top-verify-2026-10-14'
PRACTICE = 120
CRITERION = 'The final answer the response gives to the question is correct.'  # the PR 351 verify criterion


def fetch(name):
    url, digest = SOURCES[name]
    raw = urllib.request.urlopen(url, timeout=120).read()
    assert hashlib.sha256(raw).hexdigest() == digest, f'{name}: sha256 differs from the pin'
    return [json.loads(line) for line in raw.decode().splitlines() if line.strip()]


def rank(item_id):
    return hashlib.sha256(f'{SEED}:{item_id}'.encode()).hexdigest()


def question_key(text):
    return ' '.join(unicodedata.normalize('NFC', text).split())


def eligible(hard, used):
    used_ids = {r['id'] for r in used}
    used_questions = {r['id'].split('_')[0] for r in used}
    used_text = {question_key(r['instruction']) for r in used}
    items = []
    for r in hard:
        item_id = f"{r['question_id']}_{r['completion_id']}"
        if (item_id in used_ids or r['question_id'] in used_questions or
                question_key(r['question']) in used_text):
            continue
        assert isinstance(r['gold_correct'], bool)
        items.append({'id': item_id, 'group': r['source'].split('/')[0], 'label': r['gold_correct'],
                      'question': r['question'], 'response': r['completion'], 'criterion': CRITERION})
    return items


def build(hard, used):
    groups = {}
    for item in eligible(hard, used):
        groups.setdefault(question_key(item['question']), []).append(item)
    practice, confirm = [], []
    for key in sorted(groups, key=rank):
        target = practice if len(practice) < PRACTICE else confirm
        target.extend(sorted(groups[key], key=lambda x: x['id']))
    return practice, confirm


def frozen_items(hard, manifest):
    """Restore the historical membership verbatim, independently of the corrected split algorithm."""
    by_id = {f"{r['question_id']}_{r['completion_id']}": r for r in hard}
    splits = {}
    for name, spec in manifest['splits'].items():
        items = []
        for item_id in spec['ids']:
            r = by_id[item_id]
            items.append({'id': item_id, 'group': r['source'].split('/')[0], 'label': r['gold_correct'],
                          'question': r['question'], 'response': r['completion'], 'criterion': CRITERION})
        assert len(items) == spec['n']
        assert hashlib.sha256(dump(items).encode()).hexdigest() == spec['itemsSha256']
        splits[name] = items
    return splits


def dump(items):
    return json.dumps(items, ensure_ascii=False, indent=1) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--check', action='store_true', help='restore and hash-check the frozen historical items')
    ap.add_argument('--output-dir', type=Path, default=DATA / 'grouped', help='destination for a new grouped pool')
    args = ap.parse_args()
    if args.check:
        manifest = json.loads((DATA / 'manifest.json').read_text())
        splits = frozen_items(fetch('verifybench-hard'), manifest)
        for name, items in splits.items():
            (DATA / f'{name}.json').write_text(dump(items))
        print('Historical membership restored; see confirmation-exclusions.json for overlap exclusions.')
    else:
        destination = args.output_dir.resolve()
        if destination == DATA.resolve():
            ap.error('the historical data directory is frozen; choose a separate output directory')
        practice, confirm = build(fetch('verifybench-hard'), fetch('longjudge-verify'))
        splits = {'practice': practice, 'confirm': confirm}
        manifest = {'seed': SEED, 'sources': {k: {'url': u, 'sha256': d} for k, (u, d) in SOURCES.items()},
                    'splitRule': 'whole NFC/whitespace-normalized question groups, seeded hash order',
                    'excluded': 'LongJudgeBench item IDs, question IDs and normalized question texts',
                    'splits': {k: {'n': len(v), 'ids': [x['id'] for x in v],
                                   'itemsSha256': hashlib.sha256(dump(v).encode()).hexdigest()}
                               for k, v in splits.items()}}
        destination.mkdir(parents=True, exist_ok=True)
        (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        for name, items in splits.items():
            (destination / f'{name}.json').write_text(dump(items))
    print({k: len(v) for k, v in splits.items()})
    return 0


if __name__ == '__main__':
    sys.exit(main())
