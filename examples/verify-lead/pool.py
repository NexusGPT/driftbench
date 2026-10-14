"""The fresh verify pool: VerifyBench-Hard items that LongJudgeBench verify_bench_hard does not use.

LongJudgeBench verify_bench_hard is a 316-item subset of the public VerifyBench-Hard set (1,000 items,
MIT). Every one of the 316 is already in a split we used (95 DEV, 221 TEST). The other 684 items were
never sent to any judge in this repository. Items whose question also appears among the 316 are left
out, so no question we have judged returns. The remaining items are split once by a seeded hash: a
practice split for design work and a confirmation split that is judged once, after the change is frozen.

Items are not committed. `python examples/verify-lead/pool.py` downloads the pinned files, checks their
sha256 and writes data/practice.json and data/confirm.json; `--check` verifies the committed id lists.
"""
import argparse
import hashlib
import json
import sys
import urllib.request
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


def build(hard, used):
    used_ids = {r['id'] for r in used}
    used_questions = {r['id'].split('_')[0] for r in used}
    items = []
    for r in hard:
        item_id = f"{r['question_id']}_{r['completion_id']}"
        if item_id in used_ids or r['question_id'] in used_questions:
            continue
        assert isinstance(r['gold_correct'], bool)
        items.append({'id': item_id, 'group': r['source'].split('/')[0], 'label': r['gold_correct'],
                      'question': r['question'], 'response': r['completion'], 'criterion': CRITERION})
    items.sort(key=lambda x: rank(x['id']))
    return items[:PRACTICE], items[PRACTICE:]


def dump(items):
    return json.dumps(items, ensure_ascii=False, indent=1) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--check', action='store_true', help='rebuild and compare with the committed id lists only')
    args = ap.parse_args()
    practice, confirm = build(fetch('verifybench-hard'), fetch('longjudge-verify'))
    splits = {'practice': practice, 'confirm': confirm}
    manifest = {'seed': SEED, 'sources': {k: {'url': u, 'sha256': d} for k, (u, d) in SOURCES.items()},
                'excluded': 'the 316 LongJudgeBench ids and every item sharing a question with them',
                'splits': {k: {'n': len(v), 'ids': [x['id'] for x in v],
                               'itemsSha256': hashlib.sha256(dump(v).encode()).hexdigest()}
                           for k, v in splits.items()}}
    if args.check:
        committed = json.loads((DATA / 'manifest.json').read_text())
        assert committed == manifest, 'rebuilt pool differs from data/manifest.json'
    else:
        DATA.mkdir(exist_ok=True)
        (DATA / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')
    for name, items in splits.items():
        (DATA / f'{name}.json').write_text(dump(items))
    print({k: v['n'] for k, v in manifest['splits'].items()})
    return 0


if __name__ == '__main__':
    sys.exit(main())
