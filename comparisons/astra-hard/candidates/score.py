"""Score the frozen third side against the exact recorded primary peer answers."""
import collections
import copy
import datetime
from fractions import Fraction
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def main():
    runner = module('candidate_runner', HERE / 'run.py')
    commit = runner.validate_freeze()
    pf = module('rubric_audit', ROOT / 'comparisons/promptfoo/hard/run.py')
    lf = module('fact_audit', ROOT / 'comparisons/langfuse/hard/run.py')
    primary = json.loads((HERE.parent / 'scores.json').read_text())
    calls = [json.loads(x) for x in (HERE / 'calls.jsonl').read_text().splitlines()]
    starts = [json.loads(x) for x in (HERE / 'starts.jsonl').read_text().splitlines()]
    prompts = json.loads((HERE / 'prompts.json').read_text())
    assert len(calls) == len(starts) == 384
    lookup = {r['request_sha256']: r for r in calls}
    assert len(lookup) == 384 and set(lookup) == {r['request_sha256'] for r in starts}
    assert all(r['success'] and r['cost_known'] and r['preregistration_commit'] == commit for r in calls)
    for p in prompts:
        assert all(lookup[p['request_sha256']][k] == v for k, v in p.items())
    assert {m for r in calls for m in r['model_usage']} == set(primary['resolved_models'])
    rows = copy.deepcopy(primary['rows'])
    for row in rows:
        call = next(c for c in calls if (c['row'], c['id']) == (row['row'], row['id']))
        prediction = pf.outcome(call['result'], 'audit', 'rubric') if row['row'] == 'promptfoo-rubric' else lf.score('ours-audit', call['result'], 0.5)
        row['ours'] = {'prediction': prediction, 'correct': prediction == row['label'], 'cost_usd': call['cost_usd'], 'request_sha256': call['request_sha256']}
    summary = {}
    for name in ['promptfoo-rubric', 'langfuse-reference']:
        selected = [r for r in rows if r['row'] == name]
        wins = [r['id'] for r in selected if r['ours']['correct'] and not r['peer']['correct']]
        losses = [r['id'] for r in selected if not r['ours']['correct'] and r['peer']['correct']]
        n = len(wins) + len(losses)
        p = Fraction(sum(math.comb(n, k) for k in range(len(wins), n + 1)), 2 ** n)
        summary[name] = {'total': 192, 'ours_only_correct': len(wins), 'peer_only_correct': len(losses),
            'ours_only_correct_ids': wins, 'peer_only_correct_ids': losses,
            'both_correct': sum(r['ours']['correct'] and r['peer']['correct'] for r in selected),
            'both_wrong': sum(not r['ours']['correct'] and not r['peer']['correct'] for r in selected),
            'one_sided_sign_test': {'alternative': 'frozen candidate accuracy exceeds peer accuracy', 'numerator': p.numerator, 'denominator': p.denominator, 'p': float(p)},
            'verdict': 'lead' if p < Fraction(1, 20) and len(wins) > len(losses) else 'equal', 'families': {}}
        for side in ['ours', 'peer']:
            correct = sum(r[side]['correct'] for r in selected)
            cost = sum(r[side]['cost_usd'] for r in selected)
            summary[name][side] = {'correct': correct, 'accuracy': correct / 192, 'cost_usd': cost, 'usd_per_100': cost * 100 / 192,
                'inconclusive': sum(r[side]['prediction'] not in ['pass', 'fail'] for r in selected)}
        for family in sorted({r['family'] for r in selected}):
            group = [r for r in selected if r['family'] == family]
            summary[name]['families'][family] = {'total': len(group), **{s: sum(r[s]['correct'] for r in group) for s in ['ours', 'peer']}}
    fresh_cost = sum(r['cost_usd'] for r in calls)
    all_cost = fresh_cost + primary['total_cost_usd']
    assert all_cost < 10
    commit_time = datetime.datetime.fromisoformat(subprocess.check_output(['git', 'show', '-s', '--format=%cI', commit], cwd=ROOT, text=True).strip())
    first = min(datetime.datetime.fromisoformat(r['started']) for r in calls)
    last = max(datetime.datetime.fromisoformat(r['finished']) for r in calls)
    assert commit_time < first and last < runner.DEADLINE
    primary_calls = [json.loads(x) for x in (HERE.parent / 'calls.jsonl').read_text().splitlines()]
    assert first > max(datetime.datetime.fromisoformat(r['finished']) for r in primary_calls)
    events = sorted([(r['started'], 1) for r in calls + primary_calls] + [(r['finished'], -1) for r in calls + primary_calls])
    current = maximum = 0
    for _, delta in events:
        current += delta
        maximum = max(maximum, current)
    assert current == 0 and maximum <= 2
    output = {'summary': summary, 'additional_cost_usd': fresh_cost, 'primary_plus_candidate_cost_usd': all_cost,
        'resolved_models': primary['resolved_models'], 'preregistration_commit': commit, 'rows': rows}
    (HERE / 'scores.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    verification = {'preregistration_commit': commit, 'committed_at': commit_time.isoformat(), 'first_call': first.isoformat(), 'last_call': last.isoformat(),
        'additional_unique_calls': 384, 'combined_max_concurrency_upper_bound': maximum, 'unknown_costs': 0, 'retries': 0, 'additional_cost_usd': fresh_cost,
        'primary_plus_candidate_cost_usd': all_cost, 'peer_answers_reused_unchanged': True}
    (HERE / 'verification.json').write_text(json.dumps(verification, indent=2) + '\n')
    print(json.dumps({k: v for k, v in output.items() if k != 'rows'}, indent=2))


if __name__ == '__main__':
    main()
