"""Render current recorded validation metrics without network or model calls."""
import json
from pathlib import Path
from .panel_clients import ROOT, Recorder, lines


def pct(cell):
    if not cell['n']:return 'n/a'
    return f"{100*cell['accuracy']:.1f}% [{100*cell['ci95'][0]:.1f}, {100*cell['ci95'][1]:.1f}]"


def number(value):
    return 'unknown' if value is None else f'{value:.1f}'


def main():
    panel=json.loads((ROOT/'results/panel/validation.json').read_text())
    refs={b:json.loads((ROOT/f'results/reference/{b}-v2-validation.json').read_text()) for b in ('hardrows','verify-with-reference')}
    out=['# Validation comparison: moj-split-v2','',
         'All headline panel rows use the same 61 unique validation pairs, with 16 low-confidence pairs.',
         'Hardrows uses 30 validation items, with 5 low-confidence items. Verify uses 55 validation items, with 9 low-confidence items.',
         'Accuracy gives half credit to ties. Brackets are 95 percent group-bootstrap intervals, with Wilson intervals for constant binary cells.','',
         '| Cohort | Variant | n | Overall accuracy [95%] | Low-confidence accuracy [95%] | Calls / 100 | Low calls / 100 | USD / 100 |',
         '|---|---|---:|---|---|---:|---:|---|']
    for name,v in panel['variants'].items():
        a=v['matched_overall'];low=v['low'];cost='unknown'
        if name.startswith('panel-'):cost=f"unknown total; +${v['matched_incremental_usd_per_100']:.4f} panel"
        out.append(f"| Panel | {name} | {a['n']} | {pct(a)} | {pct(low)} | {number(a['calls_per_100'])} | {number(low['calls_per_100'])} | {cost} |")
    for bench,d in refs.items():
        for name,v in d['variants'].items():
            a=v['overall'];low=v['low'];cost=f"${a['known_usd_per_100']:.4f}" if a['cost_complete'] else 'unknown (Jev)'
            out.append(f"| {bench} | {name} | {a['n']} | {pct(a)} | {pct(low)} | {number(a['calls_per_100'])} | {number(low['calls_per_100'])} | {cost} |")
    out+=['','## Verify on the same recorded-baseline items','',
          'Only 19 of the 55 validation Verify items have recorded vanilla baselines. The matched rows below use exactly those 19.',
          'None of those 19 belong to the recorded low-confidence subset. The baseline prompts had no reference.','',
          '| Variant | n | Accuracy [95%] | Calls / 100 | USD / 100 |','|---|---:|---|---:|---|']
    for name,v in refs['verify-with-reference']['variants'].items():
        a=v['matched_overall'];cost=f"${a['known_usd_per_100']:.4f}" if a['cost_complete'] else 'unknown (Jev)'
        out.append(f"| {name} | {a['n']} | {pct(a)} | {number(a['calls_per_100'])} | {cost} |")
    out+=['','## Interpretation','',
          '- The panel intervals overlap. The fitted weighted variant is worse on validation; it is retained as a negative result.',
          '- The reference ablations favor supplying the dataset reference on these cohorts. They do not establish a general benchmark-independent effect.',
          '- Two returned panel outputs violate the forced-choice contract. They are retained, never retried, and incomplete panels fail closed.',
          '- Cascade costs are a counterfactual replay of the recorded full panel: the same answers, with unused third-member calls excluded.',
          '- Pairwise baseline cost gaps prevent a complete panel cost comparison. Incremental panel cost is fully recorded. Jev is unpriced, not free.','',
          '## Full initial practice population coverage','',
          'The matched panel table excludes missing baselines. This table retains those items and uses each row\'s own available coverage.',
          'A missing recorded stage-1/promptfoo fallback is a routing-coverage failure, not a panel-model error.','',
          '| Variant | n | Accuracy [95%] | Missing verdicts |','|---|---:|---|---:|']
    for name,v in panel['variants'].items():
        a=v['overall'];out.append(f"| {name} | {a['n']} | {pct(a)} | {a['missing']} |")
    calls=lines(ROOT/'results/panel/calls.jsonl');rcalls=lines(ROOT/'results/reference/calls.jsonl')
    actual=sum((x.get('answer') or {}).get('usd') or 0 for x in calls)
    out+=['','## Accounting and replay','',f'- Panel usage-based estimate: ${actual:.6f}.',
          f'- Shared accounting, including unknown-cost reservations: ${Recorder().spend():.6f} of $10.',
          f"- Returned submissions: {sum(x.get('answer') is not None for x in calls)} panel and {sum(x.get('answer') is not None for x in rcalls)} reference. Every actual call returned on submission one.",
          '- Gemini remains paused by the owner; all 52 Gemini answers predate that pause.',
          '- Panel, hardrows and Verify replay reconstruct every decision and metric from saved calls with no network.',
          '- Vanilla Verify has no reference. Its separate reference-guided DEV adapter supplies upstream reference solutions.',
          '- Verify reference ablation evaluates the complete validation half only; its fixed threshold needs no tuning calls.','']
    (ROOT/'results/panel/COMPARISON.md').write_text('\n'.join(out))
    print('\n'.join(out[:25]))


if __name__=='__main__':main()
