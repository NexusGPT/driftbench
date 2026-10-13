"""Render the sealed verify dossier from machine evidence, without model calls."""
import json
from pathlib import Path
import sys

BASE=Path(__file__).resolve().parent

def pct(v):return 'pending' if v is None else f'{100*v:.2f}%'
def money(v):return f'{v:.6f}'
def main():
    cells=json.loads((BASE/'evidence/cells.json').read_text())
    rt=json.loads((BASE/'evidence/runtime-freeze.json').read_text())
    lines=['# LongJudge verify confirmation','',f"Evidence timestamp: {cells['at']}.",'',
      '- Branch: research/ledger-verify. Core contract: PR 168 at '+rt['coreSha']+'.',
      '- All 221 TEST items are sealed. This is a previously evaluated split, not an unseen holdout.',
      '- The 221 TEST items contain 219 distinct questions. Bootstrap intervals cluster by the exact question text.',
      '- Official labels are primary. The unchanged 23-correction audit is a sensitivity analysis.',
      '- Contestants: frozen uncertainty cascade 558d75de and promptfoo llm-rubric at 8014282.',
      '- Every returned model answer stays cached. Transport failures and partial reports remain visible.','',
      '## Strict headline and product-final scores','',
      'Accuracy intervals are Wilson 95%. Paired intervals use the frozen request-cluster bootstrap.',
      'Strict is the headline: any output-limit hit makes the affected contestant/item an error, even if a later fallback returns a verdict.',
      'Product-final uses the verdict the frozen product returns, including its own fallback. Both rules apply equally to both contestants.',
      'Missing and unparsed final decisions count as wrong. An observed error is a measured outcome; a stopped run is provisional.',
      'The output-limit column counts observed TEST completion envelopes, cascade / promptfoo. Cached reuse can affect more items than envelopes.','']
    for variant in ['strict','productFinal']:
        for label in ['official','audited']:
            lines += [f"### {'Strict headline' if variant=='strict' else 'Product-final sensitivity'}, {label} labels",'',
              '| Model | Cascade accuracy [95% CI] | promptfoo accuracy [95% CI] | Output-limit answers: cascade / promptfoo | Paired difference [95% CI] | Wins / losses | Exact p | Holm p | Status |',
              '|---|---|---|---|---|---|---|---|---|']
            for cell in cells['cells']:
                d=(cell if variant=='strict' else cell.get('productFinal',{})).get(label)
                if d is None:
                    lines.append(f"| {cell['model']} | pending | pending | pending | pending | pending | pending | pending | TEST pending |");continue
                values=[f"{d['correct'][i]}/221, {pct(d['accuracy'][i])} [{pct(d['wilson95'][i][0])}, {pct(d['wilson95'][i][1])}]" for i in [0,1]]
                status='INCOMPLETE' if d['provisional'] else d['verdict']
                limits=' / '.join(str(cell['outputLimitErrors'][c]['test']['answerEnvelopes']) for c in ['driftbench-verify-uncertainty-cascade','promptfoo'])
                interval=d['deltaRequestClusterBootstrap95']
                delta=f"{pct(d['delta'])} [{pct(interval[0])}, {pct(interval[1])}]"
                lines.append(f"| {cell['model']} | {values[0]} | {values[1]} | {limits} | {delta} | {d['wins']} / {d['losses']} | {d['twoSidedExactMcNemarP']:.8g} | pending | {status} |")
            lines+=['']
    lines += ['Holm correction belongs to the prespecified 18-cell family and remains pending at this handoff. No local WIN or overall superiority claim is made.',
      'Per-item strict decisions: results/<model>.strict.json. Original product-final decisions: results/<model>.json.',
      'Exact intervals, balanced accuracy, valid-verdict coverage and paired differences: evidence/cells.json.','',
      '## Output-limit error attribution','',
      '| Model | Contestant | TEST limit answers | TEST affected items | All-phase limit answers | All-phase affected items |',
      '|---|---|---|---|---|---|']
    for cell in cells['cells']:
        for c,counts in cell['outputLimitErrors'].items():
            lines.append(f"| {cell['model']} | {c} | {counts['test']['answerEnvelopes']} | {counts['test']['affectedItems']} | {counts['all']['answerEnvelopes']} | {counts['all']['affectedItems']} |")
    errors=cells['outputLimitErrors']
    lines += ['',f"Unclassified historical native errors: {len(errors['unclassifiedHistoricalNativeErrors'])}. Unmapped confirmed limits: {len(errors['unmappedLimits'])}.",
      'Counts refer to observed completion envelopes. Native internal attempts are not inferred from aggregate turn counts.',
      'Receipt ids, exact reasons and request-to-item attribution: evidence/output-limit-errors.json. The strict rule is frozen in evidence/scoring-freeze.json.','',
      '## Cost, cheaters and validation','',
      '| Model | TEST cost per 100: cascade / promptfoo | Mutation preserve, flip, injection changes: cascade / promptfoo | Noise items with any change: cascade / promptfoo |',
      '|---|---|---|---|']
    for cell in cells['cells']:
        v=cell['validation']
        cost=cell.get('costPer100UniqueKeys',{})
        c=' / '.join(money(cost[k]) if k in cost else 'pending' for k in ['driftbench-verify-uncertainty-cascade','promptfoo'])
        mutation=' / '.join(f"{a['preserved']}/{a['baseItems']}, {a['flipped']}/{a['baseItems']}, {a['injectionMovedOrMissing']}" if a else 'pending' for a in [v['mutationChecks'].get(k,{}) for k in ['driftbench-verify-uncertainty-cascade','promptfoo']])
        noise=' / '.join(f"{v['noise'][k]['itemsWithAnyFlip']}/{v['noise'][k]['items']}" if k in v['noise'] else 'pending' for k in ['driftbench-verify-uncertainty-cascade','promptfoo'])
        lines.append(f"| {cell['model']} | {c} | {mutation} | {noise} |")
    c=cells['cheaters'];fees=cells['fees']
    lines += ['',f"Constant pass / fail: official {pct(c['alwaysPassOfficial'])} / {pct(c['alwaysFailOfficial'])}; audited {pct(c['alwaysPassAudited'])} / {pct(c['alwaysFailAudited'])}.",
      'Mutation checks cover planted arithmetic truth only. Thresholds: preserve at least 95%, flip at least 90%, no injection changes or missing verdicts.',
      'Noise uses 30 DEV items in three separate recording namespaces. A transition to or from a missing verdict counts as a change; missing counts are also reported in evidence/cells.json.',
      'Cost per 100 uses unique prompt keys; actual provider fees include any duplicate paid calls. Replayed logical-call costs are separate.',
      f"Settled fees: {money(fees['settledUsd'])} USD. Unresolved-charge maximum: {money(fees['unresolvedMaximumUsd'])} USD. Total accounted maximum: {money(fees['maximumAccountedUsd'])} USD, cap {fees['capUsd']:g} USD.",
      'Fee sources: receipts/budget.json and receipts/calls.jsonl. Historical replay cost is excluded from new spend.','',
      '## Phase coverage','', '| Model | Pilot | Mutation fixtures | Noise 0 | Noise 1 | Noise 2 | TEST |','|---|---|---|---|---|---|---|']
    for cell in cells['cells']:
        row=[]
        for phase in ['pilot','validity','noise-0','noise-1','noise-2','results']:
            p=cell['phaseCoverage'][phase]
            if 'items' not in p: row.append('pending')
            else:
                misses=list(p['missing'].values());row.append(f"{p['items']} items; missing {misses[0]}/{misses[1]}"+('; stopped' if p.get('stopped') else ''))
        lines.append('| '+cell['model']+' | '+' | '.join(row)+' |')
    lines += ['', '## Freeze and recovery','',
      '- Source and evidence hashes are in the immutable evidence/seal.json. The live upstream directory has no alternative verification item pool.',
      '- All 316 upstream ids occur in prior recordings across 68 inspected files. The 221-item fallback has explicit owner approval.',
      '- Original pilot runtime b4e4305a2426e0bb7589 is preserved. The plugin crash leaves five unknown-charge reservations totaling 3 USD.',
      '- Subsequent 180-second API timeouts and a 240-second Haiku timeout are preserved in pilot partial reports and error receipts.',
      '- The owner authorizes one resume of missing transport outputs for all models at 300 seconds. Returned answers are never retried.',
      '- The pacing amendment replaces the earlier global four-call limit: gpt-6-luna permits eight HTTP calls, Gemini two, and native Haiku two.',
      '- Both API models use medium. Haiku uses claude-haiku-5-5 through local Claude processes.',
      '- The outer process envelope includes queueing and quota backoff. Execution-only changes are recorded in evidence/execution-amendment.json.',
      '- HTTP 429 receives waits of 60, 120 and 240 seconds. Exhausted quota remains pending transport, never a judge failure.',
      '- HTTP 402 stops Gemini pending prepaid credit replenishment. Proven billing rejection holds are released; unknown network-error holds remain.',
      '- The owner raises the cap to 40 USD and requires all 379 evaluation units per model: 20 pilot, 48 mutation, 90 noise and 221 TEST.',
      '- The previous operational cutoff is removed under that full-coverage instruction before TEST.',
      '- Native error bodies and known fees are retained. Two exhausted Haiku pilot outputs are terminal and never retried.',
      '- A mock PATH-resolution error incurs a conservative 0.50 USD unknown-charge hold; evidence/native-test-resolution.json records it.',
      '- Cascade prompts, parsers, pool and audit labels remain unchanged. Keys load inside provider commands from the two authorized paths.',
      '- Dependencies are linked. No node_modules tree is copied.','',
      '| Artifact | SHA-256 |','|---|---|']
    for name,h in cells['freeze']['hashes'].items():lines.append(f'| {name} | {h} |')
    lines += ['',f"Active runtime id: {rt['id']}. Frozen core: {rt['coreSha']}.",
      'Offline checks cover source/pool hashes, exact schemas, strict replay, fail-closed missing replay and restricted Python execution.',
      'Unit checks cover statistics, strict output-limit scoring, missing outcomes, fee capture, budget reservations, concurrency and quota backoff. Historical replay reproduces 102 verdicts with zero new model calls.',
      'Sources: evidence/offline-checks.json, evidence/frozen-replay.json, test_stats.py, test_budget.py.','']
    text='\n'.join(lines)
    assert '\u2014' not in text and '\u2013' not in text
    (BASE/'REPORT.md').write_text(text)
    if len(sys.argv)>1:Path(sys.argv[1]).write_text(text)
    print('Rendered '+str(BASE/'REPORT.md'))
if __name__=='__main__':main()
