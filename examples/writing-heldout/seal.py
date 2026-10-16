"""Seal the fresh writing held-out pool and the practice pool. No model call.

The fresh pool is every WritingPreferenceBench pair that (1) passes the ledger-wp eligibility rules
(strict human preference, no LongJudge request, no recorded id), (2) shares no request with the
ledger-wp TEST seal, (3) appears in no recording, seal or result file of any other lane, and
(4) belongs to no request whose label statistics another lane already tabulated. `exclusions.json`
lists the ids behind rules 2 to 4 and the files they were found in.

The practice pool is the existing writing practice set of the MoJ research lane, minus every pair
whose request also appears in the fresh pool, so tuning never sees a fresh request.

Items carry the full texts and stay out of git (`items/` is ignored). `seal.json` is committed before
any model call; `python3 seal.py --check` rebuilds the items and verifies the committed hashes.

  python3 examples/writing-heldout/seal.py --source <dir with WP_bench_*.json> --practice <moj writing.json>
"""
import argparse
import glob
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SEED = 'writing-lead-2026-10-14-v1'


def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def canonical_pair(question, a, b):
    # Same pair id as examples/ledger-wp/prepare.py on research/ledger-wp.
    return sha(json.dumps([question, *sorted([a, b])], ensure_ascii=False, separators=(',', ':')))


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    return sha(path.read_bytes())


def fresh_items(source, ids):
    wanted, rows = set(ids), []
    for file in sorted(glob.glob(str(Path(source) / 'WP_bench_*.json'))):
        language = 'zh' if 'chinese' in file else 'en'
        for index, raw in enumerate(json.loads(Path(file).read_text())):
            question, chosen, rejected = raw['prompt'], raw['chosen']['response'], raw['rejected']['response']
            pair_id = canonical_pair(question, chosen, rejected)
            if pair_id not in wanted:
                continue
            chosen_first = int(sha(SEED + ':order:' + pair_id)[:2], 16) % 2 == 0
            rows.append({'id': pair_id, 'requestId': raw['prompt_id'], 'question': question,
                         'a': chosen if chosen_first else rejected, 'b': rejected if chosen_first else chosen,
                         'label': 'A' if chosen_first else 'B', 'language': language, 'tag': raw['tag'],
                         'sourceFile': Path(file).name, 'sourceIndex': index})
    if sorted(r['id'] for r in rows) != sorted(wanted):
        raise SystemExit('fresh pool ids not all found in the source files')
    return sorted(rows, key=lambda r: sha(SEED + ':run:' + r['id']))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--practice', required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    seal = json.loads((HERE / 'seal.json').read_text())
    fresh = fresh_items(args.source, seal['fresh']['ids'])
    fresh_questions = {r['question'] for r in fresh}
    practice = [{k: p[k] for k in ('id', 'question', 'a', 'b', 'label', 'language', 'group')}
                for p in json.loads(Path(args.practice).read_text()) if p['question'] not in fresh_questions]
    if sorted(p['id'] for p in practice) != sorted(seal['practice']['ids']):
        raise SystemExit('practice ids differ from the seal')
    hashes = {'fresh': dump(HERE / 'items' / 'fresh.json', fresh), 'practice': dump(HERE / 'items' / 'practice.json', practice)}
    for split in hashes:
        if hashes[split] != seal[split]['itemsSha256']:
            raise SystemExit(f'{split} items hash {hashes[split]} differs from the seal')
    print(json.dumps({split: {'pairs': len(rows), 'sha256': hashes[split]} for split, rows in [('fresh', fresh), ('practice', practice)]}))


if __name__ == '__main__':
    main()
