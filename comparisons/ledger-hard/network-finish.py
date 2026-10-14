"""Watch the owned serial driver, verify both complete cells, then publish and exit."""
import fcntl, subprocess, time, traceback
from common import *


def call(args):
    result = subprocess.run(args, cwd=ROOT, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT)
    print(result.stdout, flush=True)
    if result.returncode:
        raise RuntimeError(f'Command failed ({result.returncode}): {args}')
    return result.stdout


def main():
    with (HERE / 'network-finisher.lock').open('a') as own:
        fcntl.flock(own, fcntl.LOCK_EX | fcntl.LOCK_NB)
        while True:
            with (HERE / 'network-runner.lock').open('a') as driver:
                try:
                    fcntl.flock(driver, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    pass
            time.sleep(30)
        states = {c: json.loads((HERE / c / 'run-state.json').read_text())
                  for c in ('gpt-6.1-sol', 'sonnet-5-5')}
        for cell, state in states.items():
            assert state['completed'] == state['planned'] == 6560, (cell, state)
            assert state['inflight'] == 0 and state['phase'] == 'complete', (cell, state)
            call(['python3', str(HERE / 'verify-extended.py'), cell])
            scores = json.loads((HERE / cell / 'scores.json').read_text())
            assert scores['complete'] and scores['unique_calls'] == 6560
        call(['python3', str(HERE / 'audit-network-runtime.py'), '--require-complete'])
        call(['python3', str(HERE / 'assemble-report.py'), '--allow-pending-gemini'])
        closed = json.loads((HERE / 'closed-cell-reporting-amendment.json').read_text())
        for name, expected in closed['original_sha256'].items():
            assert digest(HERE / name) == expected, name
        assert call(['git', 'branch', '--show-current']).strip() == 'research/ledger-hard'
        call(['git', 'status', '--short'])
        call(['git', 'add', 'comparisons/ledger-hard'])
        call(['git', 'diff', '--cached', '--check'])
        call(['git', 'commit', '-m', 'Report complete sealed Sonnet and Sol hard-row cells'])
        call(['git', 'push', 'origin', 'research/ledger-hard'])
        head = call(['git', 'rev-parse', 'HEAD']).strip()
        remote = call(['git', 'ls-remote', 'origin', 'refs/heads/research/ledger-hard']).split()[0]
        assert head == remote
        delivery = json.loads((HERE / 'delivery.json').read_text())
        assert delivery['available_models_complete']
        dump(HERE / 'network-finish-state.json', {
            'created': stamp(), 'status': 'complete', 'commit': head,
            'dossier_sha256': delivery['dossier_sha256'],
            'gemini_3_8': json.loads((HERE / 'gemini-3.8-owner-drop.json').read_text())['status'],
            'luna_post_close_recovery': 'Not run; official result unchanged'})


if __name__ == '__main__':
    try:
        main()
    except Exception:
        dump(HERE / 'network-finish-state.json', {
            'created': stamp(), 'status': 'needs_attention', 'error': traceback.format_exc()})
        raise
