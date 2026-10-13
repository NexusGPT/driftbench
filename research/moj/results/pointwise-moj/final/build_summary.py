"""Append the verified pointwise results to RESULTS.md, without altering history."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'results/pointwise-moj'
def read(p):return json.loads(p.read_text())
final=read(OUT/'final/validation.json')
v3=read(OUT/'v3/validation.json')
two=read(OUT/'two-step/validation.json')['cells']
terrain=read(OUT/'two-step-terrain/validation.json')['cells']
prior=read(OUT/'verify-prior/validation.json')['cell']
hunt=read(OUT/'verify-evidence/validation.json')
audit=read(OUT/'label-audit/report.json')
verify=read(OUT/'final/verification.json')
lines=['## Pointwise final freeze and label audit (2026-10-13)', '',
'Frozen configuration: [pw-final-frozen.json](configs/pw-final-frozen.json). Replay: `python3 -m moj.pointwise_frozen`.',
'Practice split `moj-split-v2` only. Official labels stay unchanged. No sealed data is used.',
'The three accepted terrain cells retain their frozen policy. Blind Verify retains the previously measured Luna solve plus S1 compare expert.',
'All new System-2 contestants use gpt-6-luna. Historical single-threshold results retain their mixed panel and are identified as historical.',
'Tuning chooses thresholds. Validation has been inspected across several owner-directed rounds; these descriptive results are not fresh confirmation.',
'Verify and Verify-with-reference share items but use different grouped halves. Cross-mode tuning copies of either validation half are purged for the shared router.',
'The blind-only prior and error-hunt experiments fit on all 46 blind tuning entries and transfer no fitted parameter to the reference-guided policy.', '',
'### Official validation, frozen and ablation rows', '',
'Percentages except calls and known System-2 USD. Sensitivity is pass recall. Pairwise RubricBench sensitivity refers to label A.',
'System-1 pricing is unknown and excluded from USD. Calls represent replayed per-item policy usage, not the cost of collecting every research arm.', '',
'| Benchmark | Arm | n | Accuracy | Balanced | Sensitivity | Specificity | S2 calls/100 | Known USD/100 |',
'|---|---|---:|---:|---:|---:|---:|---:|---:|---:|']
def row(b,name,c):
 return f"| {b} | {name} | {c['n']} | "+' | '.join(f'{100*c[k]:.1f}' for k in ('accuracy','balanced','sensitivity','specificity'))+f" | {c['s2_per_100']:.1f} | {c['known_usd_per_100']:.6f} |"
for b,c in final['cells'].items():
 lines.append(row(b,'Frozen single threshold (historical)',v3['benchmarks'][b]['rows']['MoJ']))
 lines.append(row(b,'Two-step global commit',two[b]))
 lines.append(row(b,'Two-step terrain commit',terrain[b]))
 if b=='verify':
  lines.append(row(b,'Prior + disagreement second solve',prior));lines.append(row(b,'Independent error hunt, tuning rule',hunt))
 lines.append(row(b,'FINAL FREEZE',c))
lines+=['',
'Every recorded baseline, coverage denominator, matched MoJ score, cost and paired interval is beside the final configuration in [the full scoreboard](results/pointwise-moj/final/SCOREBOARD.md).',
'Same-model full-coverage comparisons include RubricBench S1 rows 93.5 and Luna rubric 88.0; hard rows ledger and Luna rubric 100.0; blind Verify always-fail 85.7.',
'The hard-row ledger uses 100 S2 calls/100 and 0.038929 USD/100; full Luna uses 100 and 0.009096. Frozen MoJ uses 55.6 and 0.006124, but loses 3.7 points.',
'On the separate 26-item domain-seat subset, frozen MoJ is 100.0 versus 98.1 at zero versus 100 S2 calls/100. This meets the requested ceiling-tie target.',
'That subset does not enter the primary full-coverage residual. Domain-seat dollar cost is unrecorded, not known to be free.', '',
'### What each bounded round established', '',
'- Two-step separation changes blind Verify from 69.4 to 79.6 and reference-guided Verify from 87.3 to 98.2. It loses RubricBench and hard-row accuracy.',
'- Per-terrain commitment restores RubricBench to 93.5 and hard rows to 96.3. The original four retention targets have residual 0/4.',
'- RubricBench uses the original row expert directly. Six escalated items consumed 12 Luna calls, or 26.1 per 100 items. Luna earned 3.5 correct versus 4.0 for rows on those six; it improved the preceding whole-answer expert from 2.5. The remaining two-item loss came from the changed commitment framing. Escalation alone did not explain the full regression.',
'- Hard-row errors were rubric.090, rubric.077, factuality.064 and factuality.013. Both S1 framings agreed incorrectly on all four; full Luna gets all four right. The terrain gate recovers the two factuality errors and retains the two rubric errors. Agreement is not proof of correctness.',
'- Prior calibration fits a smoothed tuning class prior and permits an independent second solve only when solve+compare and full Luna disagree. It uses 12 extra tuning solves and 6 validation solves. Its fitted threshold scores 71.4 on validation, below the 81.6 raw solve+compare baseline.', '',
'The prior is fitted to 10 pass labels among 46 tuning items, while validation has 7 among 49. The error-hunt threshold selected on tuning is 0.06; its grouped out-of-fold accuracy is 58.7 and validation accuracy is 59.2.',
'This threshold instability and the high-confidence consensus errors refute the claim that these raw confidence scores reliably identify correct answers.',
'The accepted hard-facts threshold is 1.01, so those items abstain. Hard-criterion threshold is 0, but commitment still requires both framings to agree.',
'Reference-guided Verify has one item classified into hard facts and sent to Luna; this leaves its verdict correct and explains the 1.8 S2 calls/100.', '',
'### Independent evidence and oracle capacity', '',
'The [four-case diagnosis](results/pointwise-moj/verify-evidence/FOUR-CASES.md) is written before the independent evidence round. The source sees question and candidate only.',
'The adjective answer assumes an unsupported complete order. Exact checks support the marble answer 9 and painting answer E. A finite countermodel check also supports the final answer that Greg\'s color is unspecified.',
'An error-hunting Luna call must quote a surviving final-answer error; System 1 verifies that allegation. Invalid or unquoted allegations cannot veto.', '',
'| Validation capacity diagnostic | Official-label maximum accuracy | Meaning |',
'|---|---:|---|',
'| Original solve+compare, arbitrary scalar cutoff | 87.8 | Validation-only ranking envelope |',
'| Solve+compare plus error hunt, arbitrary scalar cutoff | 89.8 | Above 85.7 plus 3.3, but not a deployable threshold |',
'| Existing experts, per-item oracle | 85.7 | Gold chooses among first solve, full judge, disagreement second solve |',
'| Existing experts plus error hunt, per-item oracle | 89.8 | Gold chooses the expert |',
'| Existing experts plus computed checks, per-item oracle | 87.8 | Partial computed-check coverage |',
'| Existing experts plus both sources, per-item oracle | 89.8 | No additional official-label capacity beyond error hunt |', '',
'These are restricted oracle envelopes, not universal bounds on future prompts or models. No validation oracle threshold enters the frozen configuration.',
'The error-hunt source lifts capacity, but its tuning-selected rule fails. The bounded round ends without another validation-directed rule.',
'On this official label set, none of the fitted blind judge designs tried here beats the always-fail prior. The 87.8 old ranking envelope is not an impossibility proof: new evidence raises it to 89.8. The frozen operational result remains 81.6, with 71.4 pass recall and 77.4 balanced accuracy.', '',
'### Model-free practice label audit', '',
f"All {audit['screened_n']} blind Verify practice entries are screened. Exact certificates settle {audit['proved_n']}; {audit['unresolved_n']} remain unresolved.",
f"There are {audit['label_fail_proved_correct']} recorded-fail answers proved correct and {audit['label_pass_proved_wrong']} recorded-pass answers proved wrong. Four contradictions occur in tuning and four in validation.",
'Question-specific formalizations and final-answer extractions are explicit in the check code; execution uses no model. Checks include exact rational arithmetic, finite enumeration, constraint search, Boolean truth tables, stack validation and calendar arithmetic.',
'Ambiguous language, missing final answers, inconsistent inputs and floating-point SVG reconstructions cannot authorize label changes. Conditional calculations for those items remain recorded.',
'No claim is made about label correctness outside the 48 proved entries. Screening all items does not mean proving all items.',
'The [audit scoreboard](results/pointwise-moj/label-audit/SCOREBOARD.md) includes both directions, full item ids, all check code, exact certificates, and separate proved-subset and matched-subset tables.',
'Data files remain unchanged. Only the sensitivity-analysis copy flips these eight labels; model decisions and thresholds remain fixed.', '',
'#### All blind practice: official versus proof-corrected labels', '',
'| Judge | n | Official accuracy | Official balanced | Official recall | Corrected accuracy | Corrected balanced | Corrected recall |',
'|---|---:|---:|---:|---:|---:|---:|---:|']
def audit_rows(scope):
 out=[];a=audit['scoreboards'][scope]
 for name,x in a['official'].items():
  y=a['proof_corrected_only'][name]
  out.append(f"| {name} | {x['n']} | "+' | '.join(f'{100*c[k]:.1f}' for c in (x,y) for k in ('accuracy','balanced','sensitivity'))+' |')
 return out
lines+=audit_rows('all_practice')
lines+=['', 'The rubric recordings cover 86/95 practice items and 44/49 validation items. Missing answers are not imputed.',
'On the 86 matched practice entries, official accuracies are MoJ 74.4, rubric 69.8, always-fail 81.4; corrected accuracies are 82.6, 77.9 and 77.9.', '',
'#### Validation: official versus proof-corrected labels', '',
'| Judge | n | Official accuracy | Official balanced | Official recall | Corrected accuracy | Corrected balanced | Corrected recall |',
'|---|---:|---:|---:|---:|---:|---:|---:|']
lines+=audit_rows('validation')
lines+=['',
'On the 44 matched validation entries, official accuracies are MoJ 81.8, rubric 77.3, always-fail 84.1; corrected accuracies are 90.9, 86.4 and 79.5.',
'These corrected figures are a label sensitivity analysis, not an official benchmark win. The full 95-item practice pool includes tuning and must not be called held-out validation.', '',
'### Freeze, residual and verification', '',
'Freeze the per-terrain configuration for RubricBench, hard rows and Verify-with-reference, plus the original solve+compare for blind Verify.',
'The strengthened four-cell residual is 1/4: blind Verify fails the 85.7 plus 3.3 bar. The original primary full-coverage residual remains 3/3: RubricBench ties its best baseline, hard rows miss the 100 ceiling by more than 1.7, and blind Verify trails the prior.',
'The noise numbers are recorded proxies from moj/noise.py, not new repeat runs. The 26-item domain-seat ceiling tie is reported separately and met.',
'Fifteen focused tests pass. Network-disabled replay reproduces 204 decisions for each two-step variant and the final configuration, plus the 49 prior and 49 error-hunt decisions.',
'Raw recordings reproduce 569 two-step S1 signals, 217 terrain signals, 95 error-hunt sources and 18 independent solves. Four missing S1 stage answers remain explicit. Failed-call latency is excluded from raw equality, but response, key, cost and call counts are checked.',
'No returned S1 or S2 answer is submitted twice. The three accepted cells retain their original source/config/result hashes.',
f"System-2 budget accounting is {verify['reserved_plus_known_usd']:.8f} USD against the 15 USD cap: 0.66265593 known plus 0.99546750 reserved for unpriced attempts. No cost is assigned to the model-free checks.",
'Replay evidence: [verification.json](results/pointwise-moj/final/verification.json). Label-check replay: `python3 results/pointwise-moj/label-audit/score.py`.',
'Stop here. No further fit, model call or sealed evaluation follows this freeze.', '']
section='\n'.join(lines)
assert '\u2014' not in section and '\u2013' not in section
p=ROOT/'RESULTS.md';text=p.read_text();heading=lines[0]
assert heading not in text, 'Append exactly once; preserve existing results'
p.write_text(text+'\n'+section)
(OUT/'final/SUMMARY.md').write_text(section)
print('Appended pointwise section from measured artifacts.')
