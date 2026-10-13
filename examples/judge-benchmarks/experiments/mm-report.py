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
    'All measurements below use Haiku through the harness. DEV selects the design. Tonight runs one frozen stratified test sample as a confirmation on a previously evaluated split; it is never used for tuning.',
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
        lines.append(f"| {path.stem} | {c['contestant']} | {n} | {total} | " + ' | '.join(scores) + f" | {cost:.5f} | {c['calls']/n:.4f} | {s['missing']} |")
        if s['missing'] == 0 and not report.get('stopped') and all(g in s['byGroup'] for g in groups):
            complete.append((n, s['value']['estimate'], cost, c['contestant'], path.stem))
if complete:
    biggest = max(x[0] for x in complete if x[3].startswith('driftbench-mm-')) if any(x[3].startswith('driftbench-mm-') for x in complete) else 0
    candidates = [x for x in complete if x[3].startswith('driftbench-mm-') and x[0] == biggest]
    if candidates:
        best = max(candidates, key=lambda x: x[1])
        lines.extend(['', f'Best historical pilot/common contestant row (separate from the frozen DEV400 selection above): {best[3]}, {best[1]*100:.2f}% on {best[0]} DEV pairs, USD {best[2]:.5f} per 100 items ({best[4]}).'])
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
              '', '## Historical chat cause audit and crowd proposal', '', 'This preserved snapshot records the first chat audit and its proposed architecture. Later DEV400, mandatory test and chat-only vote instructions supersede its rollout and test conditions.', '', (root / 'chat-miss-audit.md').read_text(), '',
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
        lines.append(f"| {path.stem} {i} | {r['completed']} / {r['requested']} | {r['summary']['value']['estimate']*100:.2f} | " + ' | '.join(scores) + f" | {r['costPer100']:.5f} | {r['callsPerItem']:.4f} |")
for path in sorted(root.glob('crowd*.json')):
    r = json.loads(path.read_text())
    if isinstance(r, dict) and 'completed' in r:
        lines.extend(['', f"Latest {path.stem}: {r['completed']} of {r['requested']} complete; contract {r['contractSha']}; stop: {str(r.get('stopped', 'no stop text recorded in this historical snapshot')).splitlines()[0]}. "])
lines.extend(['', '## Selective cascade and explicit premise ablation', '',
              'The lead authorizes chat-subset routing, order disagreement and parse failures as escalation signals. No label controls routing or a verdict.',
              'The direct baseline runs in both orders. A separate extraction of exact request premises precedes every safety-item ablation.',
              'Three blind references and two independent readings feed the shared comparison only on eligible items. All readers receive the premise ledger when present.',
              'A fixed proportional 400-item DEV subset selects and freezes the design before the single test sample. Remaining DEV follows only after test.',
              'Production cost excludes baseline safety calls retained only for the paired ablation. New experimental spend includes those calls.', '',
              '| Round | Direct complete / requested | Variant | Total % | Reasoning n/% | Chat n/% | Linguistics n/% | Mixing n/% | Safety n/% | Escalated % | Pending | USD / 100 | Calls / item |',
              '|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'])
for path in sorted(root.glob('cascade*-rounds.jsonl')):
    unique_phases={}
    for text in path.read_text().splitlines():
        r=json.loads(text)
        if not r['phase'].endswith('-progress') and not r['phase'].endswith('-eligibility'): unique_phases[r['phase']]=r
    for i, r in enumerate(unique_phases.values(), 1):
        if 'summary' not in r:
            continue
        for name, key in [('direct', 'directSummary'), ('current cascade', 'summary')]:
            s = r[key]
            scores = [f"{s['byGroup'][g]['n']} / {s['byGroup'][g]['value']*100:.2f}" if g in s['byGroup'] else '0 / n/a' for g in groups]
            cost = r.get('directCostPer100',r['costPer100']) if name == 'direct' else r['costPer100']
            calls = r.get('phaseCosts',{}).get('direct',{}).get('calls',r['calls']) / max(1,r['directCompleted']) if name == 'direct' else r['callsPerItem']
            lines.append(f"| {path.stem} {i}: {r['phase']} | {r['directCompleted']} / {r['requested']} | {name} | {s['value']['estimate']*100:.2f} | " + ' | '.join(scores) + f" | {r['escalatedShare']*100:.2f} | {r['pendingEscalations']} | {cost:.5f} | {calls:.4f} |")
        if 'premiseSafetySummary' in r:
            s=r['premiseSafetySummary']; g=s['byGroup']['safety']
            lines.extend(['',f"Premise ablation at {r['phase']}: {g['n']} of {r['requestedSafetyItems']} safety DEV items, {g['value']*100:.2f}%, USD {r.get('premiseSafetyCostPer100',0):.5f} per 100 safety items. Invalid premise ledgers: {r['invalidPremises']}.",''])
    if path.exists() and path.read_text().strip():
        r=json.loads(path.read_text().splitlines()[-1])
        lines.extend(['',f"Latest {path.stem}: {r['directCompleted']}/{r['requested']} direct items, {r['escalated']}/{r['eligible']} escalations, {r['premiseCompleted']}/{r['requestedSafetyItems']} premise safety items. Stop: {str(r.get('stopped','no stop text recorded in this historical snapshot')).splitlines()[0]}. Contract: {r['contractSha']}."])
lines.extend(['', 'A current cascade with pending escalation or premise work is a partial pipeline, even when its direct baseline covers every item.',
              'The five-item crowd preflight proves execution only. Its 80% score and USD 0.83797 per 100 do not establish a gain; universal crowd judging is retired.',
              'Case 4072 exposes a premise-reading error: the request explicitly says the contact is non-public, while the blind references assume public availability.',
              'Premise extraction is a measured negative result: safety falls from 91.03% direct replay to 83.33% on all 78 sampled safety items. It is dropped and excluded from freeze selection.',
              'Against the later live native-c576 baseline on the same 78 safety items, the premise result also loses: 83.33% versus 89.42%, a 6.09-point loss. Excluding the two provider-refused safety items gives 85.53% on 76; cost remains USD 0.41761 per 100 requested safety items.',
              'Next-step findings only, with no further action tonight: or becomes two mandatory requirements; a wrong technical claim is accepted; the judge imports its own identity and date into source conversations.',
              'The imported c576 contract rejects blank quotes and the audited ambiguous-opening cases. It lacks the later shared-content label-identity fix described below. Raw winners and complete replies remain available for free replay; quotes validate declared identity and never select a winner.'])
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
            total_text=f'{total*100:.2f}' if all(g in means for g in groups) else 'n/a'
            lines.append(f"| {path.stem} | {variant}: {view} | {len(scored)} | {refused} | {total_text} | "+' | '.join(scores)+' |')
for path in sorted(root.glob('cascade*-rounds.jsonl')):
    unique_phases={}
    for text in path.read_text().splitlines():
        r=json.loads(text)
        if not r['phase'].endswith('-progress') and not r['phase'].endswith('-eligibility'): unique_phases[r['phase']]=r
    for index,r in enumerate(unique_phases.values(),1):
        if 'excludedSummary' not in r:continue
        for variant,key in [('direct excluded','excludedDirectSummary'),('current cascade excluded','excludedSummary')]:
            summary=r[key];scores=[f"{summary['byGroup'][g]['value']*100:.2f}" if g in summary['byGroup'] else 'n/a' for g in groups]
            lines.append(f"| {path.stem} {index} | {variant} | {summary['n']} | {r['providerRefusedCount']} | {summary['value']['estimate']*100:.2f} | "+' | '.join(scores)+' |')
lines.extend(['',f"Provider-refused IDs across this workstream: {', '.join(sorted(provider_ids)) or 'none'}. The historical pilot/common cohorts contain no such item if their row count is zero.",
              'The first variant table preserves its historical parser-version measurements; the availability table applies the same wrong/excluded rule to the stored decisions of every contestant.',
              'Costs retain the denominator of requested items in both accuracy views, because refusal calls still consume evaluation resources.'])

if (root/'prior-test-scoring-audit.json').exists():
    audit=json.loads((root/'prior-test-scoring-audit.json').read_text())
    lines.extend(['', '## Prior test scoring and interpretation', '',
      f"Earlier MM-Eval test scoring exists on {audit['evidenceDate']}. The stored per-item census logs contain {audit['commonCompleteItems']} common fully recorded test items.",
      'The spend ledger records earlier MM-Eval stratified 1,500-item runs. Those include test items; the full test split was already exposed through its published baseline results.',
      '', '| Prior contestant | Covered test items | Total % | Reasoning % | Chat % | Linguistics % | Mixing % | Safety % |',
      '|---|---:|---:|---:|---:|---:|---:|---:|'])
    for v in audit['variants']:
        scores=[f"{v['byGroup'][g]['accuracy']*100:.2f}" for g in groups]
        lines.append(f"| {v['name']} | {audit['commonCompleteItems']} | {v['meanSubsetAccuracy']*100:.2f} | "+' | '.join(scores)+' |')
    lines.extend(['', f"Tonight's predeclared 950-item sample overlaps {audit['tonightPredeclaredOverlapWithEarlierCommonCompleteItems']} of these earlier common test items. Tonight is a confirmation on a previously evaluated split, not a pristine unseen test split.",
      'Evidence: experiments/mm-results/prior-test-scoring-audit.json, the cited Oct 12 census files, and spend-ledger rows 103, 138, 145, 161 and 177.',
      'Earlier baseline scores and the supplied census informed the task brief. The chat-vote design itself is selected on DEV400. No test item changes that frozen design.'])
if (root/'test-sample-plan.json').exists():
    plan=json.loads((root/'test-sample-plan.json').read_text())
    lines.extend(['', f"Predeclared test size: {plan['items']} of 3,529 items, fixed seed {plan['seed']}. Size is bounded by both measured latency and the remaining task budget, with three calls in parallel.",
      f"At sizing, reported task spend is USD {plan['priorSpend']['total']:.7f}. The 950-item forecast is USD {plan['estimatedNewSpendUsd']:.5f} and {plan['estimatedSeconds']/60:.1f} minutes before forecast margins. A full 3,529-item test forecast is USD {3529*json.loads((root/'freeze-selection.json').read_text())['selected']['costPer100']/100:.5f} before prior task spend, so it exceeds the USD 8 whole-task cap.",
      'Forecast margins reserve 30 minutes, multiply measured latency by 1.35, and multiply measured cost by 1.25. The report retains actual cost and completion separately from this forecast.'])
lines.extend(['', '## Frozen test sample', '',
              'Provider-refused items score zero in the official view and are excluded in a second view. The same item set and rule apply to each contestant in the comparison.',
              'Both orders of a provider-refused pair remain unavailable; code does not invent a winner. Counts and item IDs are retained in the run evidence.',
              'The 95% interval resamples pairs within each subset and then takes the unweighted mean of subset means. It measures sample uncertainty, not repeated-model variance.', '',
              '| Run | View | Completed / requested | Total % | 95% interval % | Reasoning % | Chat % | Linguistics % | Mixing % | Safety % | Refused items | USD / 100 | Calls / item |',
              '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'])
for path in sorted(root.glob('test-sample*.json')):
    if (root/'test-sample-uniform-availability.json').exists() and path.name=='test-sample-frozen.json': continue
    r=json.loads(path.read_text())
    if not isinstance(r,dict) or r.get('label')!='test sample' or 'summary' not in r:continue
    for view,key,intervalkey in [('official: refused wrong','summary','interval95'),('refused excluded','excludedSummary','excludedInterval95')]:
        if key not in r:continue
        s=r[key];ci=r[intervalkey];scores=[f"{s['byGroup'][g]['value']*100:.2f}" if g in s['byGroup'] else 'n/a' for g in groups]
        lines.append(f"| {path.stem} | {view} | {s['n']} / {r['requested']} | {s['value']['estimate']*100:.2f} | {ci['lower']*100:.2f} to {ci['upper']*100:.2f} | "+' | '.join(scores)+f" | {r['providerRefusedCount']} | {r['costPer100']:.5f} | {r['callsPerItem']:.4f} |")
    lines.extend(['',f"Frozen commit: {r['frozenCommit']}. Fixed seed: {r['seed']}. Shared contract: {r['config']['contractSha']}.",f"Provider-refused IDs: {', '.join(r['providerRefusedIds']) or 'none'}."])
    if 'availabilityProtocol' in r: lines.extend(['', r['availabilityProtocol'], 'The original frozen inference report is retained as test-sample-frozen.json. The final view re-scores its stored games under shared availability, with no new frozen-judge calls.'])
if (root/'test-peer-paired.json').exists():
    peer=json.loads((root/'test-peer-paired.json').read_text())
    lines.extend(['', '## Paired frozen TEST comparison with peers', '',
      'The initial 267-item comparison uses only recorded peer replies. All contestants use the same pair IDs in each cohort. Provider-refused items score zero for every contestant, with a second excluded view.',
      peer.get('sequentialInferenceNote','The initial fixed comparison precedes any optional peer extension.'),
      'A shared-availability cohort includes uniformly unavailable items as zero for every contestant. Such items do not add a paired win or loss; recorded-coverage and refused counts are reported separately.',
      'The exact paired sign test uses each item once, removes zero differences, and tests win direction with a binomial null probability of 0.5. It does not treat the two orders as independent or test equality of the subset macro mean. See the [binomial test reference](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.binomtest.html).',
      'Paired score differences and their intervals retain the benchmark macro mean: resample paired differences within each subset. Holm-adjusted p values cover the two peer comparisons in each cohort and view.',
      f"Additional frozen TEST items scored entirely from cache: {peer['additionalFreeScoredItems']}. These do not add model spend. Coverage outside the fixed sample can be selection biased."])
    if peer.get('conditionalPeerCoverage'):
        pc=peer['conditionalPeerCoverage']
        lines.extend(['', f"Conditional peer completion adds {pc['newCalls']} calls and USD {pc['newSpendUsd']:.7f}, completing {pc['completed']} of {pc['requested']} missing-coverage items within the same fixed 950-item sample. Stop: {pc.get('stopped','none')}.", 'No frozen-judge call or design change follows this extension. Its pooled comparison is exploratory after the initial inconclusive result. Default peer prompts and parsers stay unchanged.'])
    lines.extend(['', '| Cohort | View | Contestant | Items | Total % | Reasoning % | Chat % | Linguistics % | Mixing % | Safety % | Recorded USD / 100 |',
      '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|'])
    for cohort in peer['cohorts']:
        costs={v['name']:v['recordedCostPer100'] for v in cohort['costs']}
        for view in cohort['views']:
            for v in view['variants']:
                st=v['summary'];scores=[f"{st['byGroup'][g]['value']*100:.2f}" if g in st['byGroup'] else 'n/a' for g in groups]
                lines.append(f"| {cohort['name']} | {view['view']} | {v['name']} | {st['n']} | {st['value']['estimate']*100:.2f} | "+' | '.join(scores)+f" | {costs[v['name']]:.5f} |")
    lines.extend(['', '| Cohort | View | Peer | Ours minus peer points | Paired 95% interval points | Item wins / losses / ties | Exact two-sided p | Holm p |',
      '|---|---|---|---:|---|---|---:|---:|'])
    for cohort in peer['cohorts']:
        for view in cohort['views']:
            for d in view['pairedDifferences']:
                ci=d['interval95']
                lines.append(f"| {cohort['name']} | {view['view']} | {d['peer']} | {d['macroDifference']*100:.2f} | {ci['lower']*100:.2f} to {ci['upper']*100:.2f} | {d['wins']} / {d['losses']} / {d['ties']} | {d['exactPairedTest']['pTwoSided']:.6g} | {d['holmAdjustedP']:.6g} |")
    lines.extend(['', 'Exact probability numerators and denominators, paired IDs and all subset scores are retained in test-peer-paired.json. The full 950-item sample and this common-coverage comparison have different cohorts; scores are not interchangeable.'])
    lines.extend(['', 'The additional 211-item cohort is also reported separately from the earlier 267. The coverage order is declared before its calls, uses subset interleaving and a fixed hash seed, and never selects by our correctness or a label. One of those items is uniformly unavailable. Budget-dependent coverage is not the full test split.'])
if (root/'frozen-config.json').exists():
    frozen=json.loads((root/'frozen-config.json').read_text())
    lines.extend(['',f"Frozen design: cascade={frozen['cascade']}, safety premises={frozen['premises']}. {frozen.get('contractReviewStatus','Contract status is recorded at freeze.')}"])
    lines.extend(['', 'The lead subsequently reports approval at 8195902dd20c84267f85feba268c17868e00dfbe, one commit after c576. That change validates a leading Reply A/B label against the declared winner once, then matches its body identically against both candidates. Shared-content replies abstain regardless of label or serialization.', 'The frozen design and its reported test score use c576, which lacks that later label-identity and shared-content matching fix. Approval of 8195902d is not presented as approval of the frozen c576 contract.'])
lines.extend(['', '## Native frozen-c576 contract and chat-only voting', '',
  '| Variant | DEV items | Total % | Reasoning % | Chat % | Linguistics % | Mixing % | Safety % | USD / 100 | Calls / item |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'])
for path in sorted(root.glob('native-dev400*.json')):
    r=json.loads(path.read_text())
    if not isinstance(r,dict) or r.get('phase')!='final' or 'directSummary' not in r:continue
    for view,key in [('official','directSummary'),('refusal-excluded','excludedDirectSummary')]:
        s=r[key];scores=[f"{s['byGroup'][g]['value']*100:.2f}" if g in s['byGroup'] else 'n/a' for g in groups]
        lines.append(f"| {path.stem}: {view} | {s['n']} | {s['value']['estimate']*100:.2f} | "+' | '.join(scores)+f" | {r['directCostPer100']:.5f} | {r['phaseCosts']['direct']['calls']/r['directCompleted']:.4f} |")
for path in sorted(root.glob('vote3-dev400*.json')):
    r=json.loads(path.read_text())
    if not isinstance(r,dict) or r.get('label')!='DEV400 chat three-sample voting':continue
    for view,key in [('official','summary'),('refusal-excluded','excludedSummary')]:
        s=r[key];scores=[f"{s['byGroup'][g]['value']*100:.2f}" if g in s['byGroup'] else 'n/a' for g in groups]
        lines.append(f"| {path.stem}: {view} | {s['n']} | {s['value']['estimate']*100:.2f} | "+' | '.join(scores)+f" | {r['costPer100']:.5f} | {r['callsPerItem']:.4f} |")
    lines.extend(['',f"Chat voting completes {r['completedChat']}/{r['requestedChat']} chat items. Three native comparisons per order are pooled in code. Correlated samples are not claimed statistically independent. Stop: {r.get('stopped','none')}."])
lines.extend(['', 'The native direct stage sends current c576 prompts and JSON transcript frames live. It is distinct from free parser replay of older prompts.',
  'The chat-only voting architecture follows the supplied preference research T7. Both orders have three native declared-winner samples; code takes a majority per order. All other subsets retain native direct results.',
  'No label audit finding changes the voting prompts, aggregation rule or preference labels.'])

if (root/'vote3-dev400-cost-and-gain.json').exists():
    r=json.loads((root/'vote3-dev400-cost-and-gain.json').read_text());ci=r['pairedInterval95']
    lines.extend(['', f"Chat-only vote gain: {r['improvedItems']} items improve, {r['regressedItems']} regress, {r['unchangedItems']} stay unchanged. Net gain is {r['netPairScoreGain']:.2f} pair-score points over {r['chatItems']} chat pairs.",
      f"The total gain is {r['overallGain']*100:.2f} points; the paired 95% interval is {ci['lower']*100:.2f} to {ci['upper']*100:.2f} points. This interval includes zero, so the experiment does not establish a reliable gain.",
      f"Chat cost rises from USD {r['baseChatCostPer100']:.5f} to {r['voteChatCostPer100']:.5f} per 100 chat pairs. Calls rise from {r['baseChatCallsPerItem']:.4f} to {r['voteChatCallsPerItem']:.4f} per chat pair. Overall cost multiplier: {r['overallCostMultiplier']:.4f}."])

lines.extend(['', '## Stored raw winner re-score', '',
              '| Evidence | Shared version | Items | Changed items | Unparsed games | Blank quotes | Ambiguous quotes | Total % |',
              '|---|---|---:|---:|---:|---:|---:|---:|'])
for path in sorted(root.glob('*-rescore.json')):
    r=json.loads(path.read_text());lines.append(f"| {path.stem} | {r['contractSha']} | {r['items']} | {r['changedItems']} | {r['unparsedGames']} | {r['blankQuotes']} | {r['ambiguousQuotes']} | {r['summary']['value']['estimate']*100:.2f} |")

for path in sorted(root.glob('dev400-*-direct-replay.json')):
    r=json.loads(path.read_text())
    lines.extend(['', f'## DEV400 direct stage: {path.stem}', '',
      'Free replay uses the first valid stored attempt in each order; a repaired parser skips a re-ask that would no longer happen. Raw winner fields are unchanged.',
      'Both views apply provider-refused IDs 4141 and 4234 as wrong. Original direct inference cost is USD 0.26492 per 100 items; replay adds no model spend.', '',
      '| Class | Items | Before accuracy % | After accuracy % | Before unparsed games | After unparsed games |',
      '|---|---:|---:|---:|---:|---:|'])
    for g in groups:
        b=r['before']['byGroup'][g];a=r['summary']['byGroup'][g];u=r['byClass'][g]
        lines.append(f"| {g} | {a['n']} | {b['value']*100:.2f} | {a['value']*100:.2f} | {u['beforeUnparsed']} | {u['afterUnparsed']} |")
    before_unparsed=sum(x['beforeUnparsed'] for x in r['byClass'].values())
    lines.append(f"| Total | 400 | {r['before']['value']['estimate']*100:.2f} | {r['summary']['value']['estimate']*100:.2f} | {before_unparsed} | {r['unparsedGames']} |")
    lines.extend(['', f"After excluding the two provider-refused items: {r['excludedSummary']['value']['estimate']*100:.2f}% on 398 items. Contract: {r['contractSha']}.",
      'The lead reports 244 of 267 previously rejected attempts parsed under a6c7c7 and 254 under c5760332. Final unparsed games differ from attempts because the native contract allows one re-ask.',
      'The native comparison prompt and transcript representation also change after the original recording. Free parser replay does not measure the effect of those prompt changes.'])

if (root/'chat-label-audit-c576.md').exists():
    lines.extend(['', '## Chat label audit and separate ceiling bound', '', (root/'chat-label-audit-c576.md').read_text()])

if (root/'dev400-chat-miss-audit.md').exists():
    lines.extend(['', '## Fixed DEV400 chat audit', '', (root/'dev400-chat-miss-audit.md').read_text()])

rows = [json.loads(s) for s in Path('examples/judge-benchmarks/recordings/mmeval/haiku.jsonl').read_text().splitlines()]
new = [r for r in rows if str(r.get('contestant', '')).startswith('driftbench-mm-')]
spent = sum(r['costUsd'] for r in new)
lines.extend(['', '## Cost and verification', '',
              f'Successful new MM recordings: {len(new)} calls, USD {spent:.7f}. Reported provider-error charges: USD {provider_error_cost:.7f}. Whole-task model cap is USD 8.00.',
              'Interrupted calls without a recorded reported cost are not silently assigned an invented price.',
              f'Final reported task spend: USD {spent+provider_error_cost:.7f}. The USD 0.6 reserve for unreported interrupted charges is retained, not counted as an invented actual charge.',
              'The final guard cannot reserve another USD 0.15 request, which bounds three possible CLI attempts at USD 0.05 each. Budget admission stops further calls. No frozen DEV continuation follows the inconclusive-comparison budget allocation.',
              'Spend-ledger accounting reconciles the earlier live-replay overlap against unique successful recorded calls.',
              '', 'franc-all 7.2.0 is MIT licensed, confirmed from package metadata and the [upstream license](https://github.com/wooorm/franc/blob/main/license).',
              'The lockfile is generated with filtered pnpm add, committed separately with only franc-all entries. The latest clean rebases preserve the generated 13-line franc-all-only lockfile delta.',
              'The frozen install passes with pnpm 10.30.2. Tests use maxWorkers=2 and a 30-second timeout. The post-c576 verification passes 76 tests, including shared winner-presentation fixtures.',
              'Root TypeScript and the dedicated experiment TypeScript checks pass after c576 integration. Final checks are recorded at handover.',
              '', 'Code observations are advisory. A language mismatch does not force a winner. Short text, related languages, names and requested translations can confuse language ID.',
              'No preference label, item ID, subset name, benchmark language metadata or answer-label skew enters a model prompt. Explicitly authorized chat and safety routing uses subset metadata only in code.',
              'The dossier ceiling is an estimate, not a measured limit. This report does not claim that 95 is impossible.',
              'The lead authorizes one frozen test sample after fixed DEV400 selection. The later budget rule sends an inconclusive free267 comparison to matched default-peer coverage; otherwise remaining DEV follows. The target remains 95; the sample is not the full test split.', ''])
headline=[]
if (root/'freeze-selection.json').exists():
    selection=json.loads((root/'freeze-selection.json').read_text());best=selection['selected']
    headline.extend([f"Frozen design: {best['name']}. DEV400 {best['summary']['value']['estimate']*100:.2f}%, USD {best['costPer100']:.5f} per 100 items, {best['callsPerItem']:.4f} calls per item.", ''])
    frozen_vote=json.loads((root/'vote3-dev400-c576.json').read_text())
    headline.extend([f"DEV400 refusal-excluded score: {frozen_vote['excludedSummary']['value']['estimate']*100:.2f}% on {frozen_vote['excludedSummary']['n']} items, {len(frozen_vote['providerRefusedIds'])} excluded. Cost remains USD {best['costPer100']:.5f} per 100 requested items.", ''])
    certificate=json.loads((root/'freeze-certificate.json').read_text())
    headline.extend([f"Frozen commit: {certificate['frozenCommit']}. Shared contract at freeze: {certificate['contractSha']}.", ''])
    if (root/'test-peer-paired.json').exists():
        pp=json.loads((root/'test-peer-paired.json').read_text());last=pp['cohorts'][-1];view=last['views'][0];vs=view['variants']
        headline.extend([f"Matched shared-availability comparison: {last['items']} items, including {last['refusedItems']} unavailable. Frozen judge {vs[0]['summary']['value']['estimate']*100:.2f}%, DeepEval {vs[1]['summary']['value']['estimate']*100:.2f}%, promptfoo {vs[2]['summary']['value']['estimate']*100:.2f}%. The frozen judge has the highest observed score on this cohort.", 'Pooled inference is exploratory after the conditional peer extension. The initial fixed 267-item comparison is preserved and remains inconclusive.', ''])
    for path in sorted(root.glob('test-sample*.json')):
        if (root/'test-sample-uniform-availability.json').exists() and path.name=='test-sample-frozen.json': continue
        r=json.loads(path.read_text())
        if isinstance(r,dict) and r.get('label')=='test sample' and 'summary' in r and 'interval95' in r and r.get('completed')==r.get('requested'):
            ci=r['interval95'];headline.extend([f"Test sample, confirmation on a previously evaluated split: {r['completed']} items, {r['summary']['value']['estimate']*100:.2f}%, 95% interval {ci['lower']*100:.2f} to {ci['upper']*100:.2f}%, USD {r['costPer100']:.5f} per 100.", ''])
            headline.extend([f"Refusal-excluded test score: {r['excludedSummary']['value']['estimate']*100:.2f}% on {r['excludedSummary']['n']} items, {r['providerRefusedCount']} excluded; 95% interval {r['excludedInterval95']['lower']*100:.2f} to {r['excludedInterval95']['upper']*100:.2f}%. The cost denominator remains 950 requested items.", ''])
            if r['summary']['value']['estimate'] < .95: headline.extend(['The 95% accuracy target is not met on this frozen test sample.', ''])
if headline:lines[2:2]=headline
lines.extend(['', 'Branch head at report collation: '+subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()+'.'])
# Notes interrupt some historical round tables. Repeat their existing headers so every row renders.
rendered=[]
last_header=None
active_table=False
for i,line in enumerate(lines):
    if line.startswith('#'):
        last_header=None
    starts_header=line.startswith('|') and i+1<len(lines) and lines[i+1].startswith('|---')
    if starts_header:
        last_header=[line,lines[i+1]]
        active_table=True
    elif line.startswith('|'):
        if not active_table and not line.startswith('|---'):
            if last_header is None: raise ValueError('Orphan report table row')
            rendered.extend(['',*last_header])
        active_table=True
    else:
        active_table=False
    rendered.append(line)
# Omit headers for historical stages with no saved round rows.
clean=[]
i=0
while i<len(rendered):
    if (rendered[i].startswith('|') and i+1<len(rendered)
        and rendered[i+1].startswith('|---')
        and (i+2==len(rendered) or not rendered[i+2].startswith('|'))):
        i+=2
        continue
    clean.append(rendered[i])
    i+=1
Path(args.out).write_text('\n'.join(clean))
print(args.out)
