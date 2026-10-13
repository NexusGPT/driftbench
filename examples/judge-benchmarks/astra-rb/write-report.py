import json, pathlib, datetime, subprocess, collections
root=pathlib.Path('examples/judge-benchmarks/astra-rb')
r=json.loads((root/'results/dev.json').read_text())
base=json.loads((root/'baseline-dev.json').read_text())
frozen=json.loads((root/'frozen-design.json').read_text())
variants={v['mode']:v for v in r['variants']}
main=variants['combined']
fmt=lambda x:'n/a' if x is None else f'{100*x:.2f}%'
money=lambda x:f'${x:.6f}'
lines=['# RubricBench validated machine checks','',
 f"Measured {r['measuredAt']}. Full DEV score on {r['devItems']} pairs; partial code-execution coverage is disclosed below.",
 '',f"Combined: {main['overall']['correct']:g}/{main['overall']['n']} ({fmt(main['overall']['accuracy'])}), versus the frozen {main['overall']['baselineCorrect']:g}/{main['overall']['n']} ({fmt(main['overall']['baselineAccuracy'])}). Change: {main['deltaPoints']:+.2f} percentage points.",
 f"Feature gate: {'PASS' if main['featureGate'] else 'FAIL'}. TEST gate: {'PASS' if main['testGate'] else 'FAIL'}. No TEST call has occurred in this experiment.",
 '', '## Full-dev measurements', '',
 '| Procedure | Correct / 357 | Accuracy | Change, points | Fixes | Breaks | Extra checks / 100 | Total / 100 | Exact paired p |',
 '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
 f"| Frozen baseline | {main['overall']['baselineCorrect']:g} | {fmt(main['overall']['baselineAccuracy'])} | 0 | 0 | 0 | $0 | {money(frozen['usdPer100'])} | 1 |"]
for v in r['variants']:
 s=v['overall'];lines.append(f"| {v['mode']} | {s['correct']:g} | {fmt(s['accuracy'])} | {v['deltaPoints']:+.2f} | {len(s['fixes'])} | {len(s['breaks'])} | {money(v['extraUsdPer100'])} | {money(v['totalUsdPer100'])} | {v['pairedExact']:.6g} |")
lines+=['','| Procedure | Code/MBPP correct / 83 | Code fixes | Code breaks | Machine-decided pairs | Correct among decided | Baseline correct on same pairs |','|---|---:|---:|---:|---:|---:|---:|']
for v in r['variants']:
 c,d=v['code'],v['decided'];lines.append(f"| {v['mode']} | {c['correct']:g} | {len(c['fixes'])} | {len(c['breaks'])} | {d['n']} | {d['correct']:g} | {d['baselineCorrect']:g} |")
lines+=['','The exact paired test is the two-sided binomial McNemar test on discordant pairs. Each pair counts once. Correlated canonical presentations are not independent samples.',
 '', '## Scope, validity and coverage','',
 f"- All {r['devItems']} original dev pairs are scored. All {r['excludedTies']} council-owned ties retain their original decisions and incur no new calls.",
 f"- Code/MBPP contains {r['codePairs']} pairs. Its {r['codeTieExclusions']} ties are excluded, leaving {r['codePairs']-r['codeTieExclusions']} eligible pairs, all sent through instruction-only generation.",
 f"- There are {r['generatedPlans']} routed plans and {r['completedEvidence']} terminal evidence records. Unrouted pairs retain the frozen baseline.",
 f"- Execution contracts: {r['executionCoverage']['contracts']}; both candidates observed: {r['executionCoverage']['bothExecuted']}; at least one observed: {r['executionCoverage']['atLeastOneExecuted']}; candidate-case observations: {r['executionCoverage']['observedCases']}.",
 f"- Input validation rejects {r['executionCoverage']['rejectedInputs']} generated cases before candidate execution. Reference/example conflicts and invalid contracts abstain.",
 '- C2 generation sees the instruction only. Contract validation sees the question, rubric, generated inputs and reference, with no candidates or labels.',
 '- Each adapter sees one exact candidate, validated input previews and output types, without expected values or frozen verdicts. A separate binding audit precedes sandbox execution.',
 '- Both candidates receive identical validated inputs. Original fenced source is read from files. Allowed changes are entry points, imports, fixture binding and output serialization.',
 '- Execution uses this worktree\'s packages/sandbox localProvider plus macOS sandbox-exec. Network access and outside writes are denied. Runs have CPU, output and wall-clock limits.',
 '- An oracle-matched disagreement is final for its machine block. Both passing, both failing, absent or incomparable observations retain the frozen judge. A known fail cannot win through an unknown counterpart.',
 '- C1 programs use instruction and rubric constraints. Positive/negative fixtures and independent audits validate them. Three demonstrated parser defects are rejected through fictional adversarial fixtures before labels are inspected.',
 '- Blind source review rejects the apparent NumPy separation: its oracle requires a 2D output and a stacking axis that the instruction does not specify. The raw runs remain visible, but they cannot override the baseline.',
 '- Blind source review also rejects a browser separation caused by linkedom lacking standard HTMLFormElement.elements. A sandboxed fictional jsdom control confirms the environment gap.',
 '- Infrastructure repairs occur before labels are inspected: explicit inputs, output shape, shared test-module helpers, dependencies, TypeScript API compatibility and direct offline C# compilation. Existing valid observations are retained without reference to labels.',
 '', '## Cost accounting','',
 f"Reported research cost: {money(r['cost']['successfulUsd'])} across {r['cost']['recordedCalls']} recorded Haiku calls. The owner raises the task cap from $6 to $12 and concurrency from two to six.",
 'Per-procedure cost uses the union of recording keys needed by that procedure: generator, contract audit, adapters, binding audits and their repairs. Earlier discarded generation experiments are research cost, not deployment cost. Reused adapter attempts remain charged.',
 'Total per 100 adds the complete frozen judge cost, even for machine-decided pairs. No hypothetical skipped-judge savings are claimed.',
 'The copied CLI harness reports successful response costs. A provider refusal interrupted one batch; failed or unreturned calls lack provider cost receipts. Exact invoice cost is therefore unavailable. Reported costs are observed lower bounds, not a claimed invoice total.',
 '', '## Release decision','',
 'Feature bar: at least four fixes among the 14 frozen code/MBPP misses, zero code breaks, and extra machine-check cost below $0.07 per 100.',
 'TEST bar: at least three overall dev points. A feature-only pass does not authorize TEST. A qualifying design must be committed before the single disjoint, stratified TEST confirmation and cannot be tuned afterward.',
 f"Combined fixes: {', '.join(main['overall']['fixes']) or 'none'}. Combined breaks: {', '.join(main['overall']['breaks']) or 'none'}.",
 f"Code fixes: {', '.join(main['code']['fixes']) or 'none'}. Code breaks: {', '.join(main['code']['breaks']) or 'none'}.",
 '', '## Per-domain combined results','',
 '| Domain | Correct / n | Frozen correct | Accuracy | Wilson 95% interval |','|---|---:|---:|---:|---:|']
for domain,s in main['domains'].items():
 ci=s['wilson95'];lines.append(f"| {domain} | {s['correct']:g}/{s['n']} | {s['baselineCorrect']:g} | {fmt(s['accuracy'])} | {fmt(ci[0])} to {fmt(ci[1])} |")
lines+=['','## Frozen code/MBPP misses','', '| Pair | Final decision | Label | Machine decision | Execution status |','|---|---|---|---|---|']
cov={x['id']:x for x in r['coverage']}
for row in main['rows']:
 if row['group'] not in ['code','mbpp'] or row['before']==1:continue
 c=cov[row['id']];status='; '.join(s['side']+': '+s['status'] for s in c['sides']) or c['status']
 lines.append(f"| {row['id']} | {row['decision']} | {row['label']} | {row['machine'] or 'fallback'} | {status} |")
lines+=['','## Every code/MBPP pair','', '| Pair | Status | A observations | B observations |','|---|---|---:|---:|']
for c in r['coverage']:
 if c['group'] not in ['code','mbpp']:continue
 ss={s['side']:f"{s['status']}: {s['pass']} pass, {s['fail']} fail, {s['unknown']} unknown" for s in c['sides']}
 status=c['status'] if c['excluded'] else c['executionAbstention'] or ('execution contract' if c['executionRequested'] else 'no executable contract')
 lines.append(f"| {c['id']} | {status} | {ss.get('a','none')} | {ss.get('b','none')} |")
lines+=['','## Reproduction and provenance','',
 f"Frozen baseline commit: `{r['frozenCommit']}`. Research branch: `research/astra-rb-exec`, created from `origin/main` at `5a90bfb6`.",
 f"Decision SHA-256: `{r['decisionHash']}`.",
 'Source, model recordings, input hashes, generated programs, source-binding audits, execution observations and per-pair scores live in `examples/judge-benchmarks/astra-rb/`.',
 'The raw public dataset stays in ignored cache. No TEST item is sent to a model, and none of tonight\'s 434 sampled TEST pairs is reused.',
 'Validation: eight deterministic unit tests pass, covering fail-final behavior, unknowns, asymmetric oracles, conflicts, both-side execution, structured equality and the exact paired test. TypeScript compilation passes.',
 'Commit and remote verification are appended after the final artifact is written.', '']
text='\n'.join(lines)
assert '\u2013' not in text and '\u2014' not in text
(root/'results/REPORT.md').write_text(text)
path=pathlib.Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/opus/astra-rb.md')
path.write_text(text)
print(json.dumps({'report':str(path),'overall':main['overall']['accuracy'],'featureGate':main['featureGate'],'testGate':main['testGate']}))
