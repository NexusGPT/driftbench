"""Replay paid-call and unpaid-probe journals without reading judge outcomes."""
import argparse, collections
from common import *
r = load_module('network_audit_runner', HERE / 'extended-run.py')


def seconds(value):
    return datetime.datetime.fromisoformat(value).timestamp()


def audit(require_complete=False):
    events = []
    for cell in ('gpt-6.1-sol', 'sonnet-5-5'):
        dest = HERE / cell
        for row in r.lines(dest / 'network-probes.jsonl'):
            events.append((seconds(row['stamp']), 'probe', cell, row))
        for row in r.lines(dest / 'attempts.jsonl'):
            if row['event'] == 'backoff':
                continue
            time = row['stamp'] if row['event'] == 'start' else row['finished']
            events.append((seconds(time), row['event'], cell, row))
    # A finish timestamp is captured before journal I/O; ties use finish first.
    priority = {'finish': 0, 'probe': 1, 'start': 2}
    events.sort(key=lambda x: (x[0], priority[x[1]]))
    active = set()
    answered = set()
    counts = collections.Counter()
    states = {c: {'healthy': 0, 'last_probe': None, 'gate': False,
                  'streak': 0, 'pause_until': 0, 'gates': 0, 'trips': 0}
              for c in ('gpt-6.1-sol', 'sonnet-5-5')}
    max_active = 0
    for time, kind, cell, row in events:
        state = states[cell]
        if kind == 'probe':
            assert row['paid'] is False
            if row['consecutive_healthy'] == 1:
                assert not active, 'Fresh gate while a paid call is active'
                state['healthy'] = 0
                state['gate'] = False
            if state['last_probe'] is not None:
                assert time - state['last_probe'] >= 29.99, 'Probe spacing'
            assert time >= state['pause_until'], 'Probe before ten-minute pause'
            state['last_probe'] = time
            state['healthy'] = state['healthy'] + 1 if row['healthy'] else 0
            assert row['consecutive_healthy'] == state['healthy']
            if state['healthy'] == 10:
                assert not active, 'Gate while a paid call is active'
                state['gate'] = True
                state['streak'] = 0
                state['gates'] += 1
            continue
        key = (cell, row['request_sha256'])
        attempt = (*key, row['attempt'])
        governed = row.get('runtime') == 'network-amendment'
        if kind == 'start':
            assert key not in answered, 'Answered request resent'
            assert attempt not in active, 'Duplicate active attempt'
            if governed:
                assert state['gate'], 'Paid call before provider gate'
                assert not active or {a[0] for a in active} == {cell}, 'Models overlap'
                assert len(active) < 2, 'Runtime concurrency exceeds two'
                counts[cell + '/governed_starts'] += 1
            active.add(attempt)
            if governed:
                max_active = max(max_active, len(active))
        else:
            assert attempt in active, 'Finish without start'
            active.remove(attempt)
            raw = row.get('provider_response')
            if raw and not r.cli_no_answer(raw):
                assert key not in answered, 'More than one model answer'
                answered.add(key)
            if governed:
                state['streak'] = state['streak'] + 1 if r.connection_failure(row) else 0
                if (state['streak'] >= 3 or (row.get('error') or {}).get('type') == 'SessionLimitError') and state['gate']:
                    state['gate'] = False
                    state['healthy'] = 0
                    state['pause_until'] = time + 600
                    state['trips'] += 1
    if require_complete:
        assert not active, 'Calls remain in flight'
        for cell in states:
            proof = json.loads((HERE / cell / 'verification.json').read_text())
            assert proof['complete'], cell
    return {'created': stamp(), 'complete_cells_required': require_complete,
            'maximum_governed_concurrency': max_active,
            'governed_starts': dict(counts), 'calls_inflight': len(active),
            'model_overlap': False, 'answered_requests_resent': 0,
            'probe_and_pause_contract_verified': True,
            'models': {c: {k: s[k] for k in ('gates', 'trips')} for c, s in states.items()}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-complete', action='store_true')
    result = audit(parser.parse_args().require_complete)
    dump(HERE / 'network-verification.json', result)
    print(json.dumps(result, indent=2))
