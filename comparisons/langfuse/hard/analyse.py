"""Rebuild full-set score and error tables from recordings, without model calls."""
import argparse
import hashlib
import json
from pathlib import Path
from run import key, parse, score, wilson

ROOT = Path(__file__).resolve().parent
cli = argparse.ArgumentParser()
cli.add_argument('--set', choices=['hard.json', 'heldout-cases.json'], default='hard.json')
args = cli.parse_args()
prefix = '' if args.set == 'hard.json' else 'heldout-'
prompt_name = 'prompts.json' if args.set == 'hard.json' else 'heldout-prompts.json'
cases = json.loads((ROOT / args.set).read_text())
prompts = {p['id']: p for p in json.loads((ROOT / prompt_name).read_text())}
calls = [json.loads(line) for line in (ROOT / 'calls.jsonl').read_text().splitlines()]
cache = {c['request_sha256']: c for c in calls}
labels = {'ours': 'shipped judge', 'theirs': 'first-party Correctness template', 'ours-audit': 'fact-ledger procedure (not yet the shipped default)'}
results = {}
for side in ['ours', 'theirs', 'ours-audit']:
    rows = []
    for case in cases:
        k = key(**prompts[case['id']][side])
        if k not in cache:
            continue
        call = cache[k]
        prediction = score(side, call['result'], 1)
        rows.append({'id': case['id'], 'family': case['family'], 'label': case['label'], 'prediction': prediction, 'at_half': score(side, call['result'], .5), 'without_repair': score(side, call['result'], 1, False), 'half_without_repair': score(side, call['result'], .5, False), 'quote_repaired': bool(not parse(call['result'], False) and parse(call['result'])), 'request_sha256': k, 'cost_usd': call['cost_usd']})
    if not rows:
        continue
    correct = sum(r['prediction'] == r['label'] for r in rows)
    results[side] = {'correct': correct, 'total': len(rows), 'ci95': wilson(correct, len(rows)), 'at_half_correct': sum(r['at_half'] == r['label'] for r in rows), 'unparsed': sum(r['prediction'] == 'unparsed' for r in rows), 'without_repair_correct': sum(r['without_repair'] == r['label'] for r in rows), 'half_without_repair_correct': sum(r['half_without_repair'] == r['label'] for r in rows), 'quote_repaired': sum(r['quote_repaired'] for r in rows), 'evaluation_cost_usd': sum(r['cost_usd'] for r in rows), 'rows': rows}
summary = {'set_sha256': hashlib.sha256((ROOT / args.set).read_bytes()).hexdigest(), 'source_commit': (ROOT / 'vendor/commit.txt').read_text().strip(), 'unique_calls': len(cache), 'recorded_calls': len(calls), 'cumulative_cost_usd': sum(c['cost_usd'] for c in calls), 'variants': results}
scores_text = json.dumps(summary, indent=2) + '\n'
scores_path = ROOT / f'{prefix}scores.json'
# A replay that reproduces the committed numbers keeps the committed bytes.
if not scores_path.exists() or json.loads(scores_path.read_text()) != json.loads(scores_text):
    scores_path.write_text(scores_text)
lines = ['# Recorded scores', '', 'Exact correctness requires every requested fact and no unsupported factual assertion.', 'The continuous template is interpreted at score 1; the 0.5 interpretation is disclosed separately.', 'The hard set is the tuning set. The heldout set uses fresh profiles from the same construction families. Neither set establishes platform-wide scores.', '', '| Procedure | Correct | Wilson 95 percent | Correct at 0.5 | Recorded evaluation USD |', '|---|---|---|---|---|']
for side, result in results.items():
    lo, hi = result['ci95']
    lines.append(f"| {labels[side]} | {result['correct']}/{result['total']} | {lo * 100:.2f}% to {hi * 100:.2f}% | {result['at_half_correct']}/{result['total']} | {result['evaluation_cost_usd']:.8f} |")
lines += ['', '## Raw parsing and repair', '', '| Procedure | Raw at 1.0 | Raw at 0.5 | Repaired answers | Unparsed after repair |', '|---|---|---|---|---|']
for side, result in results.items():
    lines.append(f"| {labels[side]} | {result['without_repair_correct']}/{result['total']} | {result['half_without_repair_correct']}/{result['total']} | {result['quote_repaired']} | {result['unparsed']} |")
lines += ['', "The 1.0 threshold is preregistered. The 0.5 threshold is the template best observed setting.", 'Strict quote repair is applied to all contestants without changing verdicts or numeric scores.', '', '## Family coverage', '', '| Family | Cases | Baseline ours | Template | Audit ours |', '|---|---|---|---|---|']
for family in sorted({c['family'] for c in cases}):
    scores = []
    for side in ['ours', 'theirs', 'ours-audit']:
        rows = [r for r in results.get(side, {}).get('rows', []) if r['family'] == family]
        scores.append(f"{sum(r['prediction'] == r['label'] for r in rows)}/{len(rows)}" if rows else 'unmeasured')
    lines.append(f'| {family} | 10 | ' + ' | '.join(scores) + ' |')
for side, result in results.items():
    lines += ['', f'## {labels[side]} errors', '']
    errors = [r for r in result['rows'] if r['prediction'] != r['label']]
    if not errors:
        lines.append('None in the recorded cases.')
    for error in errors:
        case = next(c for c in cases if c['id'] == error['id'])
        lines += [f"### {error['id']}: {error['family']}", '', f"Expected: {error['label']}. Observed: {error['prediction']}.", '', 'Reply:', '', case['output'], '', 'Recorded answer:', '', '```text', cache[error['request_sha256']]['result'], '```', '']
(ROOT / f'{prefix}results.md').write_text('\n'.join(lines) + '\n')
print(json.dumps({k: {n: v for n, v in value.items() if n != 'rows'} for k, value in results.items()}, indent=2))
