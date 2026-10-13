"""Replay computed certificates, then join labels and fixed recorded decisions.

Run from research/moj: python3 results/pointwise-moj/label-audit/score.py
No fitting, model calls, references, sealed data, or dataset writes occur here.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT))
from moj import pointwise_router as r
from moj import verify_prior as v
from moj import verify_evidence as e


def main():
    cases = json.loads((HERE / 'cases.json').read_text())
    items = v.items('tune') + v.items('valid')
    assert len(cases) == len(items) == 95
    for n, (c, i) in enumerate(zip(cases, items)):
        assert c == {'index': n, 'id': i['id'], 'half': i['half'],
                     'question': i['question'], 'candidate': i['a']}
    # Pin every explicit formalization to the exact question and candidate reviewed.
    pinned = json.loads((HERE / 'input-hashes.json').read_text())
    assert pinned == {c['id']: {k: hashlib.sha256(c[k].encode()).hexdigest()
                              for k in ('question', 'candidate')} for c in cases}
    checks = []
    logs = {}
    for p in sorted(HERE.glob('checks_*.py')):
        proc = subprocess.run([sys.executable, str(p)], text=True, capture_output=True)
        logs[p.name] = {'returncode': proc.returncode, 'stdout': proc.stdout, 'stderr': proc.stderr}
        assert proc.returncode == 0, logs[p.name]
        f = HERE / p.name.replace('checks_', 'audit_').replace('.py', '.json')
        checks.extend({**row, 'check_code': p.name} for row in json.loads(f.read_text()))
    assert sorted(x['index'] for x in checks) == list(range(95))
    checks.sort(key=lambda x: x['index'])
    corrections = []
    for check, item in zip(checks, items):
        assert check['id'] == item['id']
        assert (check['status'] == 'proved') == (type(check['candidate_correct']) is bool)
        if check['status'] != 'proved':
            continue
        label = 'A' if check['candidate_correct'] else 'B'
        if label != item['label']:
            corrections.append({**check, 'half': item['half'], 'official_label': item['label'],
                                'corrected_label': label})
    edits = {x['id']: x['corrected_label'] for x in corrections}
    stores = r.load_stores()
    cutoff = json.loads((ROOT / 'configs/pw-verify-error-hunt-frozen.json').read_text())['threshold']
    predictions = {name: {} for name in ('MoJ frozen solve+compare', 'Error hunt tuning rule',
                                        'promptfoo rubric / Luna', 'Always fail')}
    for i in items:
        k = r.key(i)
        base = r.old_signal(i, 'pw_ref_luna', stores)
        predictions['MoJ frozen solve+compare'][k] = {'verdict': r.verdict(base['pA']), 'usage': base['usage']}
        audit = e.get(i)
        predictions['Error hunt tuning rule'][k] = {
            'verdict': 'A' if e.scores(i, stores)['base_plus_audit'] >= cutoff else 'B',
            'usage': base['usage'] + audit['usage']}
        rubric = r.old_signal(i, 'pw_s2v_luna', stores)
        if rubric['pA'] is not None:
            predictions['promptfoo rubric / Luna'][k] = {'verdict': r.verdict(rubric['pA']), 'usage': rubric['usage']}
        predictions['Always fail'][k] = {'verdict': 'B', 'usage': []}
    proved = {x['id'] for x in checks if x['status'] == 'proved'}
    scopes = {
        'all_practice': items,
        'validation': [i for i in items if i['half'] == 'valid'],
        'proved_subset': [i for i in items if i['id'] in proved],
        'proved_validation_subset': [i for i in items if i['id'] in proved and i['half'] == 'valid'],
    }
    # Complete matched comparisons; never fill missing promptfoo recordings.
    for name, population in list(scopes.items()):
        scopes[name + '_matched_rubric'] = [i for i in population if r.key(i) in predictions['promptfoo rubric / Luna']]
    boards = {}
    for scope, population in scopes.items():
        boards[scope] = {}
        for mode in ('official', 'proof_corrected_only'):
            its = [{**i, 'label': edits.get(i['id'], i['label'])} for i in population] if mode != 'official' else population
            boards[scope][mode] = {name: r.metrics([i for i in its if r.key(i) in ds], ds)
                                    for name, ds in predictions.items()}
    result = {
        'scope': '95 blind Verify practice items only. All screened; proofs apply only to the proved subset.',
        'method': 'Explicit question-specific formalizations, model-free execution. Ambiguity, missing answers, and uncertified geometry are excluded. Final-answer correctness only.',
        'screened_n': len(checks), 'proved_n': len(proved), 'unresolved_n': 95 - len(proved),
        'label_fail_proved_correct': sum(x['official_label'] == 'B' for x in corrections),
        'label_pass_proved_wrong': sum(x['official_label'] == 'A' for x in corrections),
        'corrections': corrections, 'checks': checks, 'scoreboards': boards,
        'predictions': predictions,
        'input_sha256': hashlib.sha256((HERE / 'cases.json').read_bytes()).hexdigest(),
        'code_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(HERE.glob('*.py'))},
    }
    r.save(HERE / 'report.json', result)
    r.save(HERE / 'replay-log.json', logs)
    lines = ['# Blind Verify practice label audit', '',
        f"Screened 95 items. Proved final-answer correctness or error on {len(proved)}; unresolved on {95-len(proved)}.",
        f"Recorded fail but proved correct: {result['label_fail_proved_correct']}. Recorded pass but proved wrong: {result['label_pass_proved_wrong']}.",
        '', 'Official labels and model predictions are unchanged. The second scoreboard flips only listed, proved contradictions.',
        'This is a sensitivity analysis, not a new official result or an estimate of errors outside the checked subset.',
        'Checks use explicit question-specific formalizations and no model execution. Full coverage means every item was screened, not that every item was proved.',
        'Missing final answers, semantic ambiguity and SVG tolerance checks cannot authorize corrections.',
        '', 'The rubric comparator uses the recorded promptfoo llm-rubric template with the same gpt-6-luna model.',
        'Its missing recordings are excluded and each denominator is explicit. Matched tables restrict every arm to the same entries.',
        'All-practice scores include tuning entries; validation remains separately identified. No threshold is refitted after label correction.']
    for scope, modes in boards.items():
        lines += ['', '## ' + scope.replace('_', ' ')]
        for mode, cells in modes.items():
            lines += ['', '### ' + mode.replace('_', ' '), '',
                '| Judge | n | Accuracy | Balanced | Pass recall | Specificity | S2 calls/100 | Known USD/100 |',
                '|---|---:|---:|---:|---:|---:|---:|---:|']
            for name, c in cells.items():
                vals = ['NA' if c[k] is None else f'{100*c[k]:.1f}' for k in ('accuracy','balanced','sensitivity','specificity')]
                lines.append(f"| {name} | {c['n']} | " + ' | '.join(vals) + f" | {c['s2_per_100']:.1f} | {c['known_usd_per_100']:.6f} |")
    lines += ['', '## Proven label contradictions', '', '| Item id | Half | Official | Corrected | Check |', '|---|---|---|---|---|']
    for x in corrections:
        lines.append(f"| `{x['id']}` | {x['half']} | {'pass' if x['official_label']=='A' else 'fail'} | {'pass' if x['corrected_label']=='A' else 'fail'} | [{x['check_code']}]({x['check_code']}) |")
    lines += ['', 'Full certificates, boundaries for every unresolved item, code hashes and fixed predictions: [report.json](report.json).',
              'Replay: `python3 results/pointwise-moj/label-audit/score.py` from `research/moj`. No network or model is required.']
    (HERE / 'SCOREBOARD.md').write_text('\n'.join(lines) + '\n')
    print(json.dumps({k: result[k] for k in ('screened_n','proved_n','unresolved_n','label_fail_proved_correct','label_pass_proved_wrong')}))
    print(json.dumps(boards['validation'], indent=2))


if __name__ == '__main__':
    main()
