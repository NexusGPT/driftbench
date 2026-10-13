"""Append terminal operational evidence to the generated writing report."""
import collections
import datetime
import json
from pathlib import Path
HERE=Path(__file__).resolve().parent
DOSSIER=Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/codex/dossier-ledger-wp.md')
def rows(path):return [json.loads(x) for x in path.read_text().splitlines() if x] if path.exists() else []
lines=['## Additive runtime completion evidence','',f'- Refreshed: {datetime.datetime.now(datetime.timezone.utc).isoformat()}.',
       '- Sonnet initial five-call projection: 66.80452213 USD. Cache-only runtime fix: DISABLE_PROMPT_CACHING=1. Fresh five-call cost: 0.155604 USD; projection: 39.98480507 USD.',
       '- The active provider requires ten consecutive healthy unauthenticated probes spaced 30 seconds apart. One model runs at a time, concurrency two. TEST requires 20 consecutive healthy DEV calls before its first submission.',
       '- Three consecutive connection failures pause ten minutes before another gate. Missing-only transport recovery has no cycle or schedule limit. Returned answers stay immutable; unknown-cost holds stay reserved. Explicit zero-token provider errors settle at zero.','',
       '| Model | Contestant | TEST known USD | All-phase known USD | All-phase held USD | TEST missing pairs | TEST cap-loss pairs |',
       '| --- | --- | --- | --- | --- | --- | --- |']
for model in ['claude-sonnet-5-5','gpt-6.1-sol']:
    d=HERE/'cells'/model;r=json.loads((d/'report.json').read_text());calls=rows(d/'calls.jsonl')
    bykey={x['key']:x for x in calls}
    for s in r['scores']:
        held=sum(v for k,v in r['spend']['pending'].items() if bykey.get(k,{}).get('contestant')==s['contestant'])
        lines.append(f"| {model} | {s['contestant']} | {s['testCostUsdIncludingTransport']:.8f} | {s['allPhaseCostUsd']:.8f} | {held:.8f} | {len(s['missingTestItems'])} | {len(s['testItemsLostToOutputCap'])} |")
    phase=json.loads((d/'phase-report.json').read_text())
    for dev in phase['dev']:
        lines.append(f"- {model} {dev['contestant']} DEV sample 0: {dev['correct']}/{dev['games']}; longer-wins {dev['controls']['longer-wins']['accuracy']}%; cheater bar {dev['cheaterBarPass']}; fixture seat {dev['earnedFixtureSeat']}; fixture kappa {dev['fixtureKappa']}; repeat-flip rate {dev['noise']['flipPercent']}%.")
    for filename in ['test-health-gate.json','audit.json','quota-hold.json']:
        if (d/filename).exists():lines.append(f"- {model} {filename}: {json.dumps(json.loads((d/filename).read_text()))}")
    test_calls=[c for c in calls if c['split']=='test']
    lines.append(f"- {model}: {len(test_calls)} TEST submissions; TEST status {'complete' if r['complete'] else 'partial' if test_calls else 'not run'}; transport failures are missing data, never judge errors.")
section='\n'.join(lines)+'\n';marker='\n## Additive runtime completion evidence\n'
base=DOSSIER.read_text().split(marker)[0]
DOSSIER.write_text(base.rstrip()+'\n\n'+section)
(HERE/'results/frontier-runtime-evidence.md').write_text(section)
print('Terminal runtime evidence appended.')
