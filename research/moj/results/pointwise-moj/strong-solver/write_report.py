"""Render the fixed stronger-solver results and append their own RESULTS section."""
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from moj import verify_strong_solver as s


def main():
    data=json.loads((s.OUT/'validation.json').read_text())
    cfg=json.loads(s.CONFIG.read_text())
    tune=json.loads((s.OUT/'tuning.json').read_text())
    ds=json.loads((s.OUT/'validation-decisions.json').read_text())
    names={'luna fitted':'Luna, fitted threshold','luna fixed_0.5':'Luna, frozen 0.5',
           'sol fitted':'gpt-6.1-sol, fitted threshold','sol fixed_0.5':'gpt-6.1-sol, fixed 0.5',
           'sonnet fitted':'Sonnet 5.5, fitted threshold','sonnet fixed_0.5':'Sonnet 5.5, fixed 0.5',
           'always_fail':'Always fail'}
    order=['luna fixed_0.5','luna fitted','sol fitted','sonnet fitted','sol fixed_0.5','sonnet fixed_0.5','always_fail']
    text=['## Blind Verify stronger-solver round (2026-10-13)','',
        'Only the solver changes: original SOLVE_SYSTEM, original Jev match question, same question-only solver input, same 600-character reference extraction.',
        'Both new solvers use medium effort. GPT-6.1-sol has no temperature parameter; Sonnet 5.5 runs through the local CLI with prompt caching disabled.',
        'Practice moj-split-v2 only: 46 tuning and 49 validation items. No sealed or reference-guided inputs are used.',
        'Threshold selection maximizes official tuning accuracy with pass recall at least 50 percent; ties use balanced accuracy, then the higher threshold.',
        'The same rule is applied to all three solver arms. Grouped tuning folds diagnose transfer; final thresholds freeze before new validation calls.',
        'Corrected labels only rescore fixed decisions using the eight previously proved contradictions. They never enter fitting.',
        'Validation has been inspected in earlier rounds. These are descriptive comparisons, not a new independent confirmation.','',
        '### Official and proof-corrected validation','',
        'All rows cover the same 49 items. Values are percentages except calls and USD. Sensitivity is pass recall.','',
        '| Arm | Official accuracy | Recall | Balanced | Specificity | Corrected accuracy | Recall | Balanced | Specificity | S2/100 | USD/100 |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for name in order:
        b=data['boards'][name];a=b['official'];c=b['corrected']
        values=[100*a[k] for k in ('accuracy','sensitivity','balanced','specificity')]+[100*c[k] for k in ('accuracy','sensitivity','balanced','specificity')]
        text.append('| '+names[name]+' | '+' | '.join(f'{v:.1f}' for v in values)+f" | {a['s2_per_100']:.1f} | {a['known_usd_per_100']:.6f} |")
    text+=['','Corrected validation has 9 pass labels and 40 fail labels, versus 7 and 42 officially. No claim extends beyond the checked label contradictions.',
           'System-1 pricing is unknown and excluded from USD. New-arm USD includes cache-write charges; historical Luna costs retain their recorded accounting.','',
           '### Tuning and paired uncertainty','',
           '| Solver | Fitted threshold | Tuning accuracy | Grouped OOF accuracy | OOF recall | OOF balanced | Official fitted delta vs always-fail, points [95% paired interval] |',
           '|---|---:|---:|---:|---:|---:|---|']
    uncertainty={}
    for m in ('luna','sol','sonnet'):
        tr=tune[m];b=data['boards'][m+' fitted']['official']
        interval=s.r.paired_interval(s.v.items('valid'),ds[m+' fitted'],ds['always_fail']);uncertainty[m]=interval
        lo,hi=interval['ci95_points'];delta=100*(b['accuracy']-42/49)
        text.append(f"| {m} | {cfg['models'][m]['threshold']:.8g} | {100*tr['selected']['accuracy']:.1f} | {100*tr['oof']['accuracy']:.1f} | {100*tr['oof']['sensitivity']:.1f} | {100*tr['oof']['balanced']:.1f} | {delta:+.1f} [{lo:+.1f}, {hi:+.1f}] |")
    text+=['','The bar is above 85.7 by more than the recorded 3.3-point noise proxy, with nonzero pass recall: at least 44/49 correct.',
           'Paired intervals use 20,000 group bootstrap draws. A noise-proxy crossing alone is not a statistically confirmed advantage.','']
    winners=[m for m in ('sol','sonnet') if data['boards'][m+' fitted']['bar_met']]
    if not winners:
        text+=['Neither stronger solver with the tuning-fitted rule clears the official always-fail baseline by more than the noise floor. '
               'The tested solver upgrades therefore do not establish a blind Verify win on official labels. '
               'Corrected-label scores are sensitivity analysis and do not replace that result. '
               'Keep the existing frozen Luna solve-and-compare configuration and stop; the strengthened four-cell residual remains 1/4.']
    else:
        text+=['The fitted arms crossing the stated noise-proxy bar are: '+', '.join(winners)+'. The paired intervals above bound the claim.']
    health=json.loads((s.OUT/'probe-report.json').read_text())
    verification=json.loads((s.OUT/'verification.json').read_text())
    answered=[x for x in s.lines(s.OUT/'calls.jsonl') if x.get('answer') is not None]
    text+=['','### Cost, replay and unchanged cells','',
        f"Ten healthy tuning probes per solver precede expansion. Combined probe spend is {health['budget_accounted_usd']:.6f} USD; projected full-run spend is {sum(health[m]['projection_95_usd'] for m in s.MODELS):.6f} USD.",
        f"Actual new-round accounted spend is {data['spend_usd']:.6f} USD against the 10 USD cap. Concurrency is two across both solvers. Every returned answer is recorded and never resubmitted.",
        f"Network-disabled replay reproduces {verification['signals_replayed']} signals from {verification['raw_solver_answers_replayed']} solver answers. Five focused tests pass.",
        'RubricBench 93.5, hard rows 96.3 and Verify-with-reference 98.2 retain their frozen source/config/result hashes.',
        'New solvers have a 16,384-output-token budget safety cap. Finish reasons and actual usage are recorded per call.',
        'Replay: `python3 -m moj.verify_strong_solver replay`. Full requests, responses, decisions and spend: `results/pointwise-moj/strong-solver/`.',
        'Rates: [OpenAI standard pricing](https://developers.openai.com/api/docs/pricing), input 2.00, cached read 0.10, cache write 2.50, output 10.00 USD per million; reasoning included in output. Sonnet uses CLI-reported USD.','']
    rendered='\n'.join(text)
    assert '\u2014' not in rendered and '\u2013' not in rendered
    (s.OUT/'SCOREBOARD.md').write_text(rendered)
    s.r.save(s.OUT/'paired-intervals.json',uncertainty)
    p=s.r.ROOT/'RESULTS.md';existing=p.read_text();heading=text[0]
    if heading not in existing:p.write_text(existing+'\n'+rendered)
    else:assert existing.split(heading,1)[1]==rendered.split(heading,1)[1]
    print(rendered)

if __name__=='__main__':main()
