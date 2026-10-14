"""LongJudgeBench verify DEV items (95), the split every earlier verify judge was tuned on, for design work only.

The split rule is examples/judge-benchmarks/src/data.ts splitOf: sha256("split:longjudge-verify:<id>"), first
byte under 77 is DEV. TEST items are never written. Writes data/dev.json (not committed)."""
import ast
import hashlib
import json
import sys

import pool


def main():
    rows = pool.fetch('longjudge-verify')
    items = []
    for r in rows:
        if hashlib.sha256(f"split:longjudge-verify:{r['id']}".encode()).digest()[0] >= 77:
            continue
        truth = r['ground_truth'] if isinstance(r['ground_truth'], dict) else ast.literal_eval(r['ground_truth'])
        responses = r['responses'] if isinstance(r['responses'], list) else ast.literal_eval(r['responses'])
        items.append({'id': r['id'], 'group': 'correct' if truth['gold_correct'] else 'incorrect',
                      'label': truth['gold_correct'] is True, 'question': r['instruction'],
                      'response': responses[0]['content'], 'criterion': pool.CRITERION})
    assert len(items) == 95, len(items)
    (pool.DATA / 'dev.json').write_text(pool.dump(items))
    print(len(items), sum(x['label'] for x in items))
    return 0


if __name__ == '__main__':
    sys.exit(main())
