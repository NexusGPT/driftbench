"""Free replay using native decoders and an exact directional paired sign test."""
import collections
from fractions import Fraction
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def sign_test(wins, losses):
    n = wins + losses
    return Fraction(sum(math.comb(n, k) for k in range(wins, n + 1)), 2 ** n)


def main():
    spec = importlib.util.spec_from_file_location('reference_score', ROOT / 'comparisons/langfuse/hard/run.py')
    decoder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(decoder)
    calls = [json.loads(line) for line in (HERE / 'calls.jsonl').read_text().splitlines()]
    assert len(calls) == 768 and len({r['request_sha256'] for r in calls}) == 768
    assert all(r['success'] and r['cost_known'] for r in calls)
    assert len({model for r in calls for model in r['model_usage']}) == 1
    prompts = json.loads((HERE / 'prompts.json').read_text())
    lookup = {r['request_sha256']: r for r in calls}
    for p in prompts:
        assert all(lookup[p['request_sha256']][k] == v for k, v in p.items())
    native_calls = [r for r in calls if r['side'] == 'ours' or r['row'] == 'promptfoo-rubric']
    native = subprocess.run(['node', '--import', 'tsx', str(HERE / 'native.mts'), 'score'],
        input=json.dumps(native_calls), text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        cwd=ROOT, check=True)
    scores = {r['request_sha256']: s for r, s in zip(native_calls, json.loads(native.stdout), strict=True)}
    rows = []
    summary = {}
    for name in ['promptfoo-rubric', 'langfuse-reference']:
        cases = json.loads((HERE / f'{name}-cases.json').read_text())
        for case in cases:
            item = {'row': name, 'id': case['id'], 'family': case.get('kind', case.get('family')),
                    'label': ('pass' if case['truth'] else 'fail') if 'truth' in case else case['label']}
            for side in ['ours', 'peer']:
                call = next(r for r in calls if (r['row'], r['id'], r['side']) == (name, case['id'], side))
                result = scores.get(call['request_sha256'])
                if result is None:
                    result = {'prediction': decoder.score('theirs', call['result'], 0.5),
                        'without_quote_repair': decoder.score('theirs', call['result'], 0.5, False)}
                item[side] = {**result, 'cost_usd': call['cost_usd'], 'request_sha256': call['request_sha256']}
                item[side]['correct'] = item[side]['prediction'] == item['label']
            rows.append(item)
        selected = [r for r in rows if r['row'] == name]
        wins = [r['id'] for r in selected if r['ours']['correct'] and not r['peer']['correct']]
        losses = [r['id'] for r in selected if r['peer']['correct'] and not r['ours']['correct']]
        p = sign_test(len(wins), len(losses))
        summary[name] = {'total': len(selected), 'ours_only_correct': len(wins), 'peer_only_correct': len(losses),
            'both_correct': sum(r['ours']['correct'] and r['peer']['correct'] for r in selected),
            'both_wrong': sum(not r['ours']['correct'] and not r['peer']['correct'] for r in selected),
            'one_sided_sign_test': {'alternative': 'driftbench accuracy exceeds peer accuracy',
                'numerator': p.numerator, 'denominator': p.denominator, 'p': float(p)},
            'ours_only_correct_ids': wins, 'peer_only_correct_ids': losses, 'families': {}}
        for side in ['ours', 'peer']:
            correct = sum(r[side]['correct'] for r in selected)
            cost = sum(r[side]['cost_usd'] for r in selected)
            summary[name][side] = {'correct': correct, 'accuracy': correct / len(selected),
                'cost_usd': cost, 'usd_per_100': cost * 100 / len(selected),
                'inconclusive': sum(r[side]['prediction'] not in ['pass', 'fail'] for r in selected)}
        for family in sorted({r['family'] for r in selected}):
            group = [r for r in selected if r['family'] == family]
            summary[name]['families'][family] = {'total': len(group), **{s: sum(r[s]['correct'] for r in group) for s in ['ours', 'peer']}}
    output = {'summary': summary, 'total_cost_usd': sum(r['cost_usd'] for r in calls),
        'resolved_models': sorted({m for r in calls for m in r['model_usage']}),
        'preregistration_commits': sorted({r['preregistration_commit'] for r in calls}), 'rows': rows}
    (HERE / 'scores.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in output.items() if k != 'rows'}, indent=2))


if __name__ == '__main__':
    main()
