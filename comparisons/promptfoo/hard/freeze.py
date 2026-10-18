"""Freeze the comparison candidate before the first held-out model call."""
import json
from run import HERE, procedure_fingerprint, recordings, stamp


if __name__ == '__main__':
    assert not any(r.get('set') == 'heldout' for r in recordings()), 'Held-out scoring has already begun.'
    for row in ['rubric', 'factuality', 'pii', 'goal']:
        for side in ['peer', 'shipped', 'audit']:
            data = json.loads((HERE / f'recorded/{row}-{side}.json').read_text())
            assert len(data['rows']) == 120, (row, side)
    manifest = json.loads((HERE / 'heldout-manifest.json').read_text())
    value = dict(frozen=stamp(), procedure_sha256=procedure_fingerprint(), candidate_label='not yet the shipped default', heldout_seed=manifest['seed'], heldout_cases_per_row=manifest['cases_per_row'], rule='No candidate tuning from held-out outcomes.')
    (HERE / 'candidate-freeze.json').write_text(json.dumps(value, indent=2) + '\n')
    print(json.dumps(value))
