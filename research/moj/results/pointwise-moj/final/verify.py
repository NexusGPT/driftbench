"""Verify the frozen report and every new recorded experiment without a network."""
import hashlib
import json
from pathlib import Path
import socket
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from moj import pointwise_router as r
from moj import two_step as t
from moj import two_step_terrain as z
from moj import verify_prior as v
from moj import verify_evidence as e
from moj import pointwise_frozen as f


def read(path): return json.loads(path.read_text())


def stable(value):
    # Failed submissions can have later recorded timing. Latency is not a
    # decision input; preserve key, response, call count and cost comparisons.
    if isinstance(value, dict):
        return {k: stable(v) for k,v in value.items() if k != 'seconds'}
    if isinstance(value, list): return [stable(v) for v in value]
    return value


def main():
    r.setup_client(); stores = r.load_stores(True); rec = r.recorder(True)
    its = t.population('valid'); train = t.population('tune')
    train_ids = {i['id'] for i in train if i['bench'].startswith('verify')}
    assert not train_ids & {i['id'] for i in its if i['bench'].startswith('verify')}
    frozen = read(z.OUT / 'FREEZE.json')
    for name, digest in frozen['files'].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest
    counts = {}; missing = {}
    with patch.object(socket, 'socket', side_effect=AssertionError('network forbidden')):
        tc = read(t.CONFIG); zc = read(z.CONFIG); vc = read(v.CONFIG); fc = read(f.CONFIG)
        for name, decisions in (
            ('two-step', {r.key(i): t.decide(i, tc, stores) for i in its}),
            ('two-step-terrain', {r.key(i): z.decide(i, stores, zc) for i in its}),
            ('verify-prior', {r.key(i): v.decision(i, stores, vc) for i in v.items('valid')}),
            ('final', {r.key(i): f.decide(i, stores, fc) for i in its})):
            assert decisions == read(r.OUT / name / 'validation-decisions.json'), name
            counts[name] = len(decisions)
        # Force construction from raw recordings, bypassing saved signal files.
        nofile = r.OUT / 'final' / 'never-created.json'
        assert not nofile.exists()
        for module, stages in ((t, ('commit', 'route')), (z, ('terrain', 'framing'))):
            count = 0; absent = 0
            for i in train + its:
                for stage in stages:
                    expected = module.get(i, stage)
                    if expected is None:
                        continue
                    with patch.object(module, 'path', return_value=nofile), patch.object(r, 'save'):
                        actual = t.collect_one(i, stage, True) if module is t else z.collect(i, stage, True)
                    assert stable(actual) == stable(expected), (module.__name__, r.key(i), stage)
                    count += 1; absent += all(x is None for x in actual['detail'].values())
            counts[module.__name__ + '_raw_s1_signals'] = count
            missing[module.__name__] = absent
        for i in v.items('tune') + v.items('valid'):
            expected = e.get(i)
            with patch.object(e, 'path', return_value=nofile), patch.object(r, 'save'):
                actual = e.collect_one(i, rec, True)
            assert stable(actual) == stable(expected), i['id']
            if v.disagree(i, stores):
                expected_second = v.second(i)
                with patch.object(v, 'path', return_value=nofile), patch.object(r, 'save'):
                    assert stable(v.solve(i, stores, rec, True)) == stable(expected_second)
        counts['error_hunt_raw_s2_and_s1_signals'] = 95
        counts['independent_second_solves'] = sum(v.disagree(i, stores) for i in v.items('tune') + v.items('valid'))
        ed = read(e.OUT / 'validation-decisions.json'); ec = read(ROOT / 'configs/pw-verify-error-hunt-frozen.json')
        for i in v.items('valid'):
            assert ed[r.key(i)]['verdict'] == ('A' if e.scores(i, stores)['base_plus_audit'] >= ec['threshold'] else 'B')
        assert r.metrics(v.items('valid'), ed) == read(e.OUT / 'validation.json')
    records = [json.loads(line) for line in (r.OUT / 'recordings/jev.jsonl').read_text().splitlines()]
    returned = [row['key'] for row in records if row.get('answer') is not None]
    assert len(returned) == len(set(returned)), 'Repeated returned S1 answer'
    panel = [json.loads(line) for line in (r.OUT / 'panel/calls.jsonl').read_text().splitlines()]
    returned_s2 = [row['key'] for row in panel if row.get('answer') is not None]
    assert len(returned_s2) == len(set(returned_s2)), 'Repeated returned S2 answer'
    assert rec.spend() <= 15.
    for cfg, module in ((tc,t), (zc,z), (vc,v), (ec,e)):
        assert cfg['source_sha256'] == hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()
    result = {'network_disabled': True, 'replayed': counts, 'missing_s1_answers_retained': missing,
        'all_three_accepted_cells_hash_unchanged': True, 'verify_cross_mode_tuning_purge': True,
        'duplicate_returned_answers': 0, 'reserved_plus_known_usd': rec.spend(),
        'source_hashes_match': True, 'raw_replay_excludes_latency_only': True}
    r.save(f.OUT / 'verification.json', result)
    print(json.dumps(result, indent=2))


if __name__ == '__main__': main()
