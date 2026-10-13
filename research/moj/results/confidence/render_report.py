"""Render saved confidence JSON into a human-readable report, without rerunning."""
import json
from pathlib import Path
import sys


def fmt(x):
    return 'n/a' if x is None else f'{x:.3f}'


def render(directory):
    root = Path(directory)
    manifest = json.loads((root / 'manifest.json').read_text())
    settings = manifest['settings']
    reports = {b: json.loads((root / (b + '.json')).read_text()) for b in ('judgebench', 'mmeval', 'writing')}
    text = ['# Confidence experiment report', '',
            'All numbers use recorded practice signals. No model calls or sealed TEST data.', '',
            'Gold accuracy gives ties half credit. Full agreement is exact verdict agreement with the frozen reference.',
            'Thresholds and named points are selected on tuning only. Validation sweeps are descriptive.', '',
            '## Validation operating points', '', (root / 'summary.md').read_text(),
            'S1 ECE is the binary probability ECE for gold event A. It is separate from full-judge agreement.',
            'A balanced point with target_feasible=false does not meet its requested tuning constraints.', '',
            '## Validation calibration of every expert', '',
            '| Benchmark | Expert | Tune / validation n | Gold-event ECE before | Gold-event ECE after | Full agreement target |',
            '|---|---|---:|---:|---:|---|']
    for bench, report in reports.items():
        for name, c in report['calibration'].items():
            text.append(f"| {bench} | {name} | {c['tune_n']} / {c['validation_n']} | {fmt(c['before']['ece'])} | {fmt(c['after']['ece'] if c['after'] else None)} | Not fitted by this map |")
    text += ['', 'Each expert JSON includes the monotone map and all ten reliability bins. No empty bin is converted to zero accuracy.', '',
             '## Validation methods and confidence levels', '',
             '| Benchmark | Method | Level | n | Share | Gold accuracy | Full agreement |',
             '|---|---|---|---:|---:|---:|---:|']
    for bench, report in reports.items():
        for method, m in report['methods'].items():
            for level, c in m['levels'].items():
                text.append(f"| {bench} | {method} | {level} | {c['n']} | {fmt(c['share'])} | {fmt(c['gold_accuracy'])} | {fmt(c['full_agreement'])} |")
    text += ['', f"## Random-split sensitivity, {settings['splits']} practice splits per method", '',
             f"| Benchmark | Method | Mean gold accuracy | Mean full agreement | Full target >= {settings['target']}, splits | Early target held / nonempty early splits | Nontrivial certificates |",
             '|---|---|---:|---:|---:|---:|---:|']
    for bench, report in reports.items():
        for method, m in report['random_audit']['summary'].items():
            text.append(f"| {bench} | {method} | {fmt(m['mean_gold_accuracy'])} | {fmt(m['mean_full_agreement'])} | {m['overall_target_held']} / {m['splits']} | {m['early_target_held']} / {m['nonempty_early_splits']} | {m['nontrivial_certificates']} |")
    text += ['', 'Full-only passes the full-agreement target by identity, with no certified savings.',
             'Empty early-exit sets are not successes. Fixed and CV policies carry no guarantee.',
             'Random splits overlap. Their rates are descriptive, not independent trials or a proof of population risk control.', '',
             '## Certification sample sizes', '',
             '| Benchmark | Practice n | Tune / validation n | Independent certification n | Error-free accepted labels needed per enabled exit | Full target / risk | Gold accuracy guarantee |',
             '|---|---:|---:|---:|---:|---|---|']
    for bench, r in reports.items():
        c = r['certificate']
        text.append(f"| {bench} | {r['practice_n']} | {r['tune_n']} / {r['valid_n']} | {c['calibration_n']} | {c['minimum_error_free_labels_per_enabled_exit']} | {c['target_full_agreement']} / {c['risk']} | None |")
    minima = manifest['guarantee_minimum_labels']
    text += ['', f"The grid uses 72 simultaneous one-sided binomial bounds. One prespecified region needs {minima['one_frozen_region']} error-free labels; two prespecified regions need {minima['two_frozen_regions']} each.",
             'These are per accepted calibration region, independent of model-fitting labels. They are best-case minima with zero disagreement.',
             'The guarantee assumes fixed judges and independent, identically distributed calibration and future items.', '',
             '## Missing signals and cost interpretation', '',
             '- MM-Eval contains 45 recorded pairs in this snapshot, not 50.',
             '- The first-token top-two log probabilities are absent; only the binary Jev margin is measured.',
             '- Some recorded baseline costs and Jev prices are absent. Cost units use the declared S2 weight, not invented fees.',
             '- Per-benchmark SVG and CSV curves retain gold accuracy and full agreement as separate series.',
             '- The full reference and its calibration reserve stay frozen. Changing the reference requires recertification.', '']
    if any(not r.get('group_metadata_complete', False) for r in reports.values()):
        text += ['## Split provenance limitation', '',
                 'This core signal snapshot has no source group keys. These are historical pair-split diagnostics, not evidence under moj-split-v2.',
                 'The new harness split keeps common prompts together; updated signal metadata is required before claiming group-independent validation.',
                 'The module now respects group_key when supplied and rejects overlapping fixed halves or correlated certification groups.', '']
    path = root / 'report.md'
    with path.open('x') as handle:
        handle.write('\n'.join(text))
    print(path)


if __name__ == '__main__':
    render(sys.argv[1])
