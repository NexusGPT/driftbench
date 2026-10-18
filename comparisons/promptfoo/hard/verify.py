"""Verify full coverage, frozen prompt keys, parsing and finite costs without fresh calls."""
import json
import hashlib
import datetime
import math
import subprocess
from run import HERE, key_for, outcome, recordings, render_audit, render_peer, procedure_fingerprint
from generate import make_sets, TRAIN_SEED, HELDOUT_SEED


def verify():
    by_key = {r['request_sha256']: r for r in recordings() if r['success']}
    calls = recordings()
    assert all(math.isfinite(r['charged_usd']) and r['charged_usd'] >= 0 for r in calls)
    assert sum(r['charged_usd'] for r in calls) <= 8
    assert all(r['cost_known'] for r in calls), 'Unknown costs require explicit disclosure.'
    for flags in [[], ['--heldout']]:
        subprocess.run(['pnpm', 'exec', 'tsx', str(HERE / 'render.mts'), '--verify', *flags], cwd=HERE.parents[2], check=True)
    subprocess.run(['pnpm', 'exec', 'tsx', str(HERE / 'trajectory-parity.mts')], cwd=HERE.parents[2], check=True)
    subprocess.run(['pnpm', 'exec', 'tsx', str(HERE / 'decoder-parity.mts')], cwd=HERE.parents[2], check=True)
    subprocess.run(['pnpm', 'exec', 'tsx', str(HERE / 'peer-decoder-parity.mts')], cwd=HERE.parents[2], check=True)
    native = json.loads((HERE / 'recorded/shipped-native-decoder.json').read_text())
    for key, parsed in native.items():
        assert outcome(by_key[key]['text'], 'shipped', by_key[key]['row']) == parsed, (key, 'baseline decoder differs from production')
    peer_native = json.loads((HERE / 'recorded/peer-native-decoder.json').read_text())
    for key, parsed in peer_native.items():
        assert outcome(by_key[key]['text'], by_key[key]['side'], by_key[key]['row']) == parsed, (key, 'peer decoder differs from pinned native verdict functions')
    covered = 0
    manifest = json.loads((HERE / 'heldout-manifest.json').read_text())
    freeze = json.loads((HERE / 'candidate-freeze.json').read_text())
    assert freeze['procedure_sha256'] == procedure_fingerprint()
    first_held = min(datetime.datetime.fromisoformat(r['started']) for r in calls if r.get('set') == 'heldout')
    assert datetime.datetime.fromisoformat(manifest['generated']) <= first_held
    assert all(datetime.datetime.fromisoformat(r['stamp']) <= first_held for r in manifest.get('revisions', []))
    assert datetime.datetime.fromisoformat(freeze['frozen']) <= first_held
    assert max(datetime.datetime.fromisoformat(r['finished']) for r in calls if r.get('set', 'hard') == 'hard') <= first_held
    for fold, seed, n in [('hard', TRAIN_SEED, 120), ('heldout', HELDOUT_SEED, 72)]:
        prefix = 'heldout-' if fold == 'heldout' else ''
        for row, cases in make_sets(seed, n).items():
            shipped = json.loads((HERE / f'{prefix}{row}-shipped-prompts.json').read_text())
            stored = json.loads((HERE / f'{prefix}{row}.json').read_text())
            assert stored == cases, f'{prefix}{row} differs from deterministic generation'
            if fold == 'heldout':
                digest = hashlib.sha256(json.dumps(cases, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
                assert digest == manifest['canonical_hashes'][row]
            sides = ['peer', 'shipped', 'audit'] + (['peer-full-state'] if row == 'goal' else [])
            for side in sides:
                recorded = json.loads((HERE / f'recorded/{prefix}{row}-{side}.json').read_text())['rows']
                assert len(recorded) == n, (fold, row, side, len(recorded))
                ids = {r['id']: r for r in recorded}
                assert len(ids) == n
                for case in cases:
                    r = ids[case['id']]
                    prompt = shipped[case['id']] if side == 'shipped' else render_audit(case, row) if side == 'audit' else render_peer(case, row, side == 'peer-full-state')
                    key = key_for(prompt)
                    assert r['request_sha256'] == key, (case['id'], side, 'changed prompt')
                    assert key in by_key, (case['id'], side, 'missing successful call')
                    assert by_key[key]['prompt'] == prompt
                    assert r['truth'] == case['truth']
                    assert r['outcome'] == outcome(by_key[key]['text'], side, row)
                    assert r['call_cost'] == by_key[key]['charged_usd']
                    covered += 1
    print(f'{covered} case/procedure decisions verified; no model calls.')


if __name__ == '__main__':
    verify()
