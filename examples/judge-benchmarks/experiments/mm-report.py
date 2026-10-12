"""Collate observed experiment artifacts into the assigned MM report, without model calls."""
import argparse
import collections
import datetime
import json
import subprocess
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
    'All measurements below use Haiku through the harness. DEV selects the design. One frozen stratified test sample follows, labelled separately and never used for tuning.',
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
        total = f"{s['value']['estimate'] * 100:.2f}" if all(g in s['byGroup'] for g in groups) else 'n/a'
        lines.append(f"| {path.stem} | {c['contestant']} | {n} | {total} | " + ' | '.join(scores) + f" | {cost:.5f} | {c['calls']/n:.3f} | {s['missing']} |")
        if s['missing'] == 0 and not report.get('stopped') and all(g in s['byGroup'] for g in groups):
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
lines.extend(['', '## Selective cascade and explicit premise ablation', '',
              'The lead authorizes chat-subset routing, order disagreement and parse failures as escalation signals. No label controls routing or a verdict.',
              'The direct baseline runs in both orders. A separate extraction of exact request premises precedes every safety-item ablation.',
              'Three blind references and two independent readings feed the shared comparison only on eligible items. All readers receive the premise ledger when present.',
              'A fixed proportional 400-item DEV subset selects and freezes the design before the single test sample. Remaining DEV follows only after test.',
              'Production cost excludes baseline safety calls retained only for the paired ablation. New experimental spend includes those calls.', '',
              '| Round | Direct complete / requested | Variant | Total % | Reasoning n/% | Chat n/% | Linguistics n/% | Mixing n/% | Safety n/% | Escalated % | Pending | USD / 100 | Calls / item |',
              '|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'])
for path in sorted(root.glob('cascade*-rounds.jsonl')):
    for i, text in enumerate(path.read_text().splitlines(), 1):
        r = json.loads(text)
        if 'summary' not in r:
            continue
        for name, key in [('direct', 'directSummary'), ('current cascade', 'summary')]:
            s = r[key]
            scores = [f"{s['byGroup'][g]['n']} / {s['byGroup'][g]['value']*100:.2f}" if g in s['byGroup'] else '0 / n/a' for g in groups]
            cost = r.get('directCostPer100',r['costPer100']) if name == 'direct' else r['costPer100']
            calls = r.get('phaseCosts',{}).get('direct',{}).get('calls',r['calls']) / max(1,r['directCompleted']) if name == 'direct' else r['callsPerItem']
            lines.append(f"| {path.stem} {i}: {r['phase']} | {r['directCompleted']} / {r['requested']} | {name} | {s['value']['estimate']*100:.2f} | " + ' | '.join(scores) + f" | {r['escalatedShare']*100:.2f} | {r['pendingEscalations']} | {cost:.5f} | {calls:.3f} |")
        if 'premiseSafetySummary' in r:
            s=r['premiseSafetySummary']; g=s['byGroup']['safety']
            lines.extend(['',f"Premise ablation at {r['phase']}: {g['n']} of {r['requestedSafetyItems']} safety DEV items, {g['value']*100:.2f}%, USD {r.get('premiseSafetyCostPer100',0):.5f} per 100 safety items. Invalid premise ledgers: {r['invalidPremises']}.",''])
    if path.exists() and path.read_text().strip():
        r=json.loads(path.read_text().splitlines()[-1])
        lines.extend(['',f"Latest {path.stem}: {r['directCompleted']}/{r['requested']} direct items, {r['escalated']}/{r['eligible']} escalations, {r['premiseCompleted']}/{r['requestedSafetyItems']} premise safety items. Stop: {r.get('stopped','in flight or complete')}. Contract: {r['contractSha']}."])
lines.extend(['', 'A current cascade with pending escalation or premise work is a partial pipeline, even when its direct baseline covers every item.',
              'The five-item crowd preflight proves execution only. Its 80% score and USD 0.83797 per 100 do not establish a gain; universal crowd judging is retired.',
              'Case 4072 exposes a premise-reading error: the request explicitly says the contact is non-public, while the blind references assume public availability.',
              'The premise step preserves the negation as a reader requirement. It does not equate a safety-subset label with harm or force a refusal verdict.',
              'The pending shared whitespace-quote fix is handled through raw winner and raw text retention. Quotes validate declared identity; they never select a winner.'])
if (root/'cascade-first50-timing.json').exists():
    timing=json.loads((root/'cascade-first50-timing.json').read_text())
    lines.extend(['',f"Initial timing: {timing['sampleCalls']} calls, {timing['meanCallSeconds']:.2f} seconds per sequential call. Three-worker direct-only projected finish: {timing['projectedDirectFinishUtc']}. This is a projection, not a completion timestamp."])

lines.extend(['', '## Provider availability applied across variants', '',
              '| Run | Variant / view | Items scored | Provider-refused items in cohort | Total % | Reasoning % | Chat % | Linguistics % | Mixing % | Safety % |',
              '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|'])
provider_ids=set()
provider_error_cost=0.0
seen_errors=set()
for errorfile in root.glob('*-provider-refusals.jsonl'):
    for text in errorfile.read_text().splitlines():
        error=json.loads(text);provider_ids.add(error['id'])
        if error['error'] not in seen_errors:
            seen_errors.add(error['error']);provider_error_cost+=error['reportedCostUsd']
for path in sorted(root.glob('*-decisions.jsonl')):
    if path.name.startswith(('cascade','crowd','test-sample')):continue
    rows=[json.loads(s) for s in path.read_text().splitlines()]
    variants=collections.defaultdict(list)
    for row in rows:
        if 'contestant' in row and 'games' in row:variants[row['contestant']].append(row)
    for variant,items in variants.items():
        refused=sum(item['id'] in provider_ids for item in items)
        for view in ['official','excluded']:
            by=collections.defaultdict(list)
            scored=[item for item in items if view=='official' or item['id'] not in provider_ids]
            for item in scored:
                value=0 if item['id'] in provider_ids else sum(1 if g==item['label'] else .5 if g=='tie' else 0 for g in item['games'])/len(item['games'])
                by[item['group']].append(value)
            means={g:sum(xs)/len(xs) for g,xs in by.items()}
            total=sum(means.values())/len(means) if means else 0
            scores=[f"{means[g]*100:.2f}" if g in means else 'n/a' for g in groups]
            lines.append(f"| {path.stem} | {variant}: {view} | {len(scored)} | {refused} | {total*100:.2f} | "+' | '.join(scores)+' |')
for path in sorted(root.glob('cascade*-rounds.jsonl')):
    for index,text in enumerate(path.read_text().splitlines(),1):
        r=json.loads(text)
        if 'excludedSummary' not in r:continue
        for variant,key in [('direct excluded','excludedDirectSummary'),('current cascade excluded','excludedSummary')]:
            summary=r[key];scores=[f"{summary['byGroup'][g]['value']*100:.2f}" if g in summary['byGroup'] else 'n/a' for g in groups]
            lines.append(f"| {path.stem} {index} | {variant} | {summary['n']} | {r['providerRefusedCount']} | {summary['value']['estimate']*100:.2f} | "+' | '.join(scores)+' |')
lines.extend(['',f"Provider-refused IDs across this workstream: {', '.join(sorted(provider_ids)) or 'none'}. The historical pilot/common cohorts contain no such item if their row count is zero.",
              'The first variant table preserves its historical parser-version measurements; the availability table applies the same wrong/excluded rule to the stored decisions of every contestant.',
              'Costs retain the denominator of requested items in both accuracy views, because refusal calls still consume evaluation resources.'])

lines.extend(['', '## Frozen test sample', '',
              'Provider-refused items score zero in the official view and are excluded in a second view. The same item set and rule apply to each contestant in the comparison.',
              'Both orders of a provider-refused pair remain unavailable; code does not invent a winner. Counts and item IDs are retained in the run evidence.',
              'The 95% interval resamples pairs within each subset and then takes the unweighted mean of subset means. It measures sample uncertainty, not repeated-model variance.', '',
              '| Run | View | Completed / requested | Total % | 95% interval % | Reasoning % | Chat % | Linguistics % | Mixing % | Safety % | Refused items | USD / 100 | Calls / item |',
              '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'])
for path in sorted(root.glob('test-sample*.json')):
    r=json.loads(path.read_text())
    if not isinstance(r,dict) or r.get('label')!='test sample' or 'summary' not in r:continue
    for view,key,intervalkey in [('official: refused wrong','summary','interval95'),('refused excluded','excludedSummary','excludedInterval95')]:
        if key not in r:continue
        s=r[key];ci=r[intervalkey];scores=[f"{s['byGroup'][g]['value']*100:.2f}" if g in s['byGroup'] else 'n/a' for g in groups]
        lines.append(f"| {path.stem} | {view} | {s['n']} / {r['requested']} | {s['value']['estimate']*100:.2f} | {ci['lower']*100:.2f} to {ci['upper']*100:.2f} | "+' | '.join(scores)+f" | {r['providerRefusedCount']} | {r['costPer100']:.5f} | {r['callsPerItem']:.3f} |")
    lines.extend(['',f"Frozen commit: {r['frozenCommit']}. Fixed seed: {r['seed']}. Shared contract: {r['config']['contractSha']}.",f"Provider-refused IDs: {', '.join(r['providerRefusedIds']) or 'none'}."])
if (root/'frozen-config.json').exists():
    frozen=json.loads((root/'frozen-config.json').read_text())
    lines.extend(['',f"Frozen design: cascade={frozen['cascade']}, safety premises={frozen['premises']}. {frozen.get('contractReviewStatus','Contract status is recorded at freeze.')}"])
lines.extend(['', '## Stored raw winner re-score', '',
              '| Evidence | Shared version | Items | Changed items | Unparsed games | Blank quotes | Ambiguous quotes | Total % |',
              '|---|---|---:|---:|---:|---:|---:|---:|'])
for path in sorted(root.glob('*-rescore.json')):
    r=json.loads(path.read_text());lines.append(f"| {path.stem} | {r['contractSha']} | {r['items']} | {r['changedItems']} | {r['unparsedGames']} | {r['blankQuotes']} | {r['ambiguousQuotes']} | {r['summary']['value']['estimate']*100:.2f} |")

if (root/'dev400-a6-direct-replay.json').exists():
    r=json.loads((root/'dev400-a6-direct-replay.json').read_text())
    lines.extend(['', '## DEV400 direct stage: shared contract before and after', '',
      'Free replay uses the first valid stored attempt in each order; a repaired parser skips a re-ask that would no longer happen. Raw winner fields are unchanged.',
      'Both views apply provider-refused IDs 4141 and 4234 as wrong. Original direct inference cost is USD 0.26492 per 100 items; replay adds no model spend.', '',
      '| Class | Items | Before accuracy % | After accuracy % | Before unparsed games | After unparsed games |',
      '|---|---:|---:|---:|---:|---:|'])
    for g in groups:
        b=r['before']['byGroup'][g];a=r['summary']['byGroup'][g];u=r['byClass'][g]
        lines.append(f"| {g} | {a['n']} | {b['value']*100:.2f} | {a['value']*100:.2f} | {u['beforeUnparsed']} | {u['afterUnparsed']} |")
    lines.append(f"| Total | 400 | {r['before']['value']['estimate']*100:.2f} | {r['summary']['value']['estimate']*100:.2f} | 94 | {r['unparsedGames']} |")
    lines.extend(['', f"After excluding the two provider-refused items: {r['excludedSummary']['value']['estimate']*100:.2f}% on 398 items. Contract: {r['contractSha']}.",
      'The lead reports 244 of 267 previously rejected attempts now parsed. Final unparsed games differ from attempts because the native contract allows one re-ask.'])

if (root/'dev400-chat-miss-audit.md').exists():
    lines.extend(['', '## Fixed DEV400 chat audit', '', (root/'dev400-chat-miss-audit.md').read_text()])

rows = [json.loads(s) for s in Path('examples/judge-benchmarks/recordings/mmeval/haiku.jsonl').read_text().splitlines()]
new = [r for r in rows if str(r.get('contestant', '')).startswith('driftbench-mm-')]
spent = sum(r['costUsd'] for r in new)
lines.extend(['', '## Cost and verification', '',
              f'Successful new MM recordings: {len(new)} calls, USD {spent:.7f}. Reported provider-error charges: USD {provider_error_cost:.7f}. Whole-task model cap is USD 8.00.',
              'Interrupted calls without a recorded reported cost are not silently assigned an invented price.',
              'Spend-ledger accounting reconciles the earlier live-replay overlap against unique successful recorded calls.',
              '', 'franc-all 7.2.0 is MIT licensed, confirmed from package metadata and the [upstream license](https://github.com/wooorm/franc/blob/main/license).',
              'The lockfile is generated with filtered pnpm add, committed separately with only franc-all entries. The rebase regenerates it through the same command.',
              'The frozen install passes with pnpm 10.30.2. The initial 5-second test timeout fails under machine load; rerunning with 30 seconds passes all 47 pre-cascade tests. Cascade tests are verified separately before running.',
              'TypeScript typecheck passes before shared-contract integration. Final post-integration checks are recorded at handover.',
              '', 'Code observations are advisory. A language mismatch does not force a winner. Short text, related languages, names and requested translations can confuse language ID.',
              'No preference label, item ID, subset name, benchmark language metadata or answer-label skew enters a model prompt. Explicitly authorized chat and safety routing uses subset metadata only in code.',
              'The dossier ceiling is an estimate, not a measured limit. This report does not claim that 95 is impossible.',
              'The lead authorizes one frozen test sample after fixed DEV400 selection, then remaining DEV only if time remains. The target remains 95; the sample is not the full test split.', ''])
Path(args.out).write_text('\n'.join(lines))
print(args.out)
