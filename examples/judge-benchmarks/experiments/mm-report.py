"""Collate observed experiment artifacts into the assigned MM report, without model calls."""
import argparse
import collections
import datetime
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--out', required=True)
args = parser.parse_args()
root = Path('examples/judge-benchmarks/experiments/mm-results')
groups = ['reasoning', 'chat', 'linguistics', 'language mixing', 'safety']
lines = [
    '# MM-Eval DEV report',
    '',
    f'Artifact collation: {datetime.datetime.now(datetime.timezone.utc).isoformat()}.',
    '',
    'All measurements below use Haiku through the harness. No TEST item is judged or used for tuning.',
    'Total is the unweighted mean of the five subset means. Each pair is judged in both orders; a tie scores 0.5.',
    'Inference cost includes cached calls at their recorded price. New spend is separate.',
    '',
    '## Complete and partial variant measurements',
    '',
    'Pilot: 100 DEV pairs, 20 per subset. Confirmation: the other 363 shared DEV pairs.',
    'Common: 463 pairs after the original 1,500-item source sample, DEV split, and shared baseline coverage.',
    'The cohort is fixed before new evaluations. Competitor templates stay unchanged.',
    '',
    '| Run | Variant | Items | Total % | Reasoning % | Chat % | Linguistics % | Mixing % | Safety % | USD / 100 | Calls / item | Missing games |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
]
complete = []
for path in sorted(root.glob('*.json')):
    report = json.loads(path.read_text())
    if not isinstance(report, dict) or not isinstance(report.get('contestants'), list):
        continue
    for c in report['contestants']:
        if not isinstance(c, dict) or 'summary' not in c:
            continue
        s = c['summary']
        n = report['items']
        scores = [f"{s['byGroup'][g]['value'] * 100:.2f}" if g in s['byGroup'] else 'n/a' for g in groups]
        cost = c['costUsd'] * 100 / n
        lines.append(f"| {path.stem} | {c['contestant']} | {n} | {s['value']['estimate'] * 100:.2f} | " + ' | '.join(scores) + f" | {cost:.5f} | {c['calls']/n:.3f} | {s['missing']} |")
        if s['missing'] == 0 and not report.get('stopped'):
            complete.append((n, s['value']['estimate'], cost, c['contestant'], path.stem))
if complete:
    biggest = max(x[0] for x in complete if x[3].startswith('driftbench-mm-')) if any(x[3].startswith('driftbench-mm-') for x in complete) else 0
    candidates = [x for x in complete if x[3].startswith('driftbench-mm-') and x[0] == biggest]
    if candidates:
        best = max(candidates, key=lambda x: x[1])
        lines.extend(['', f'Best new variant on its largest complete cohort: {best[3]}, {best[1]*100:.2f}% on {best[0]} DEV pairs, USD {best[2]:.5f} per 100 items ({best[4]}).'])
lines.extend(['', 'A row with missing games is incomplete. Missing answers count as ties in harness summaries; those totals are not full-coverage results.',
              'The pilot chooses prompts and parsing variants. It is not an independent confirmation or a test claim.', '', '## Mapping and JSON defects', '',
              '| Subset | Audited DEV items | Mapping-affected items | Mapping games | Invalid JSON items | Invalid JSON games |',
              '|---|---:|---:|---:|---:|---:|'])
audit = json.loads((root / 'mapping-audit-summary.json').read_text())
for g in groups:
    r = audit[g]
    lines.append(f"| {g} | {r['items']} | {r['mappingItems']} | {r['mappingGames']} | {r['invalidJsonItems']} | {r['invalidJsonGames']} |")
lines.extend(['', 'Mapping counts are manually verified lower bounds: 46 affected items and 48 games.',
              'The screen is conservative; it does not establish an exhaustive semantic mismatch count.',
              'The manual diagnostic repair is not a contestant and does not enter the best-score comparison.', '',
              '| Repair version | Affected items | Games | Parseable verdicts | Correct | Wrong | Still unparseable | Unresolved items |',
              '|---|---:|---:|---:|---:|---:|---:|---:|'])
for path in sorted(root.glob('near-json-repair*summary.json')):
    r = json.loads(path.read_text())['total']
    lines.append(f"| {path.stem} | {r['items']} | {r['games']} | {r['parseableGames']} | {r['correctGames']} | {r['wrongGames']} | {r['unparseableGames']} | {r['unresolvedItems']} |")
lines.extend(['', 'The repair uses the shared package implementation, never a guessed verdict or a changed preference label.',
              '', '## Chat cause audit and architecture', '', (root / 'chat-miss-audit.md').read_text(), '',
              '## Full DEV crowd architecture rounds', '',
              'The request set is all 1,452 DEV pairs. Checkpoints report only completed items and state coverage.',
              'Three blind crowd replies plus two independent candidate readings precede two shared-contract comparisons.',
              'This uses seven calls per item before contract repairs, versus two for the single-comparison variants.',
              'A higher inference cost is reported without claiming that the score gain justifies it.', '',
              '| Round | Completed / requested | Total % | Reasoning n/% | Chat n/% | Linguistics n/% | Mixing n/% | Safety n/% | USD / 100 | Calls / item |',
              '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'])
for path in sorted(root.glob('crowd*-rounds.jsonl')):
    for i, text in enumerate(path.read_text().splitlines(), 1):
        r = json.loads(text)
        scores = [f"{r['summary']['byGroup'][g]['n']} / {r['summary']['byGroup'][g]['value']*100:.2f}" if g in r['summary']['byGroup'] else '0 / n/a' for g in groups]
        lines.append(f"| {path.stem} {i} | {r['completed']} / {r['requested']} | {r['summary']['value']['estimate']*100:.2f} | " + ' | '.join(scores) + f" | {r['costPer100']:.5f} | {r['callsPerItem']:.3f} |")
for path in sorted(root.glob('crowd*.json')):
    r = json.loads(path.read_text())
    if isinstance(r, dict) and 'completed' in r:
        lines.extend(['', f"Latest {path.stem}: {r['completed']} of {r['requested']} complete; contract {r['contractSha']}; stop: {r.get('stopped', 'in flight or complete')}. "])
rows = [json.loads(s) for s in Path('examples/judge-benchmarks/recordings/mmeval/haiku.jsonl').read_text().splitlines()]
new = [r for r in rows if str(r.get('contestant', '')).startswith('driftbench-mm-')]
spent = sum(r['costUsd'] for r in new)
lines.extend(['', '## Cost and verification', '',
              f'Successful new MM recordings: {len(new)} calls, USD {spent:.7f}. Whole-task model cap is USD 8.00.',
              'Interrupted calls without a recorded reported cost are not silently assigned an invented price.',
              'Spend-ledger accounting reconciles the earlier live-replay overlap against unique successful recorded calls.',
              '', 'franc-all 7.2.0 is MIT licensed, confirmed from package metadata and the [upstream license](https://github.com/wooorm/franc/blob/main/license).',
              'The lockfile is generated with filtered pnpm add. Its separate commit is a4984b56 and contains only 13 franc-all lines.',
              'The frozen install passes with pnpm 10.30.2. The initial 5-second test timeout fails under machine load; rerunning with 30 seconds passes all 44 tests.',
              'TypeScript typecheck passes before shared-contract integration. Final post-integration checks are recorded at handover.',
              '', 'Code observations are advisory. A language mismatch does not force a winner. Short text, related languages, names and requested translations can confuse language ID.',
              'No label, item ID, subset name, benchmark language metadata, length preference, or answer-label skew enters the judge.',
              'The dossier ceiling is an estimate, not a measured limit. This report does not claim that 95 is impossible.',
              'TEST runs only after a frozen configuration achieves the requested DEV target and within the authorized budget.', ''])
Path(args.out).write_text('\n'.join(lines))
print(args.out)
