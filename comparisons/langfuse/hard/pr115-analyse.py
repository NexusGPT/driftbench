"""Report the pinned default beside the four original rows, without changing recordings."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
new = json.loads((ROOT / 'pr115-scores.json').read_text())
hard = json.loads((ROOT / 'scores.json').read_text())['variants']
heldout = json.loads((ROOT / 'heldout-scores.json').read_text())['variants']

def previous(name, side, half=False):
    a, b = hard[side], heldout[side]
    return (name, a['at_half_correct'] if half else a['correct'], b['at_half_correct'] if half else b['correct'], a['evaluation_cost_usd'] / a['total'] * 100, b['evaluation_cost_usd'] / b['total'] * 100)

rows = [
    previous('Shipped judge, previous contract', 'ours'),
    previous('fact-ledger procedure (not yet the shipped default)', 'ours-audit'),
    previous('Template, preregistered 1.0', 'theirs'),
    previous('Template, best reported setting 0.5', 'theirs', True),
]
a, b = new['summary']['hard.json'], new['summary']['heldout-cases.json']
rows.append(('PR 115 default', a['correct'], b['correct'], a['usd_per_100'], b['usd_per_100']))
lines = ['# PR 115 default: frozen reference correctness', '', f"Judge source: `{new['judge_commit']}`. One model call per case. Cases, labels, criterion and the uniform repair are unchanged.", '', '| Procedure | Tuning hard | Frozen held-out | Tuning USD / 100 | Held-out USD / 100 |', '|---|---|---|---|---|']
for name, correct, held, cost, heldcost in rows:
    lines.append(f'| {name} | {correct}/120 | {held}/120 | ${cost:.6f} | ${heldcost:.6f} |')
lines += ['', 'The template rows share model calls and charges. The older shipped row remains the measured previous contract. The experimental fact-ledger procedure is separate from the default requirement ledger.', '', 'The held-out set is reused, and its prior scores are known before this measurement. It is not a newly generated blind holdout for PR 115. The one-item margin on each set does not establish statistical superiority.', '', '## PR 115 confidence, parsing and cost', '', '| Set | Correct | Wilson 95 percent | Without repair | Quote repairs | Unparsed | Inconclusive | USD |', '|---|---|---|---|---|---|---|---|']
for set_name, summary in new['summary'].items():
    lo, hi = summary['ci95']
    lines.append(f"| {set_name} | {summary['correct']}/{summary['total']} | {lo * 100:.2f}% to {hi * 100:.2f}% | {summary['without_repair_correct']}/{summary['total']} | {summary['quote_repaired']} | {summary['unparsed']} | {summary['inconclusive']} | ${summary['evaluation_cost_usd']:.8f} |")
lines += ['', f"The new round costs ${new['round_cost_usd']:.8f}. It adds 240 unique calls. No model answer is retried or selected to replace another.", '', '## Family coverage', '', '| Family | Hard correct | Held-out correct |', '|---|---|---|']
for family in sorted({row['family'] for row in new['rows']}):
    values = []
    for set_name in ['hard.json', 'heldout-cases.json']:
        subset = [row for row in new['rows'] if row['family'] == family and row['set'] == set_name]
        values.append(f"{sum(row['label'] == row['prediction'] for row in subset)}/{len(subset)}")
    lines.append(f'| {family} | ' + ' | '.join(values) + ' |')
cache = {row['request_sha256']: row for row in map(json.loads, (ROOT / 'pr115-calls.jsonl').read_text().splitlines())}
cases = {set_name: {row['id']: row for row in json.loads((ROOT / set_name).read_text())} for set_name in ['hard.json', 'heldout-cases.json']}
for set_name in ['hard.json', 'heldout-cases.json']:
    lines += ['', f'## {set_name} errors', '']
    errors = [row for row in new['rows'] if row['set'] == set_name and row['prediction'] != row['label']]
    if not errors:
        lines.append('None in the recorded cases.')
    for row in errors:
        case = cases[set_name][row['id']]
        lines += [f"### {row['id']}: {row['family']}", '', f"Expected: {row['label']}. Observed: {row['prediction']}.", '', 'Reply:', '', case['output'], '', 'Recorded answer:', '', '```text', cache[row['request_sha256']]['result'], '```', '', 'Native contract result:', '', '```json', json.dumps(row['native_result'], indent=2), '```', '']
(ROOT / 'pr115-results.md').write_text('\n'.join(lines) + '\n')
print('\n'.join(lines[:14]))
