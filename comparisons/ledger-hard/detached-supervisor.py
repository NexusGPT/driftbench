"""Detached, serial hard-row supervisor. Network and session waits never end it."""
import fcntl, os, signal, subprocess, threading, time, traceback
from common import *
n = load_module('supervised_network_runner', HERE / 'network-resume.py')
FINISHED = threading.Event()
STATE = {'phase': 'starting', 'cell': None}
STATE_LOCK = threading.Lock()


def state(phase, **extra):
    with STATE_LOCK:
        STATE.update(phase=phase, **extra)


def heartbeat():
    while not FINISHED.is_set():
        with STATE_LOCK:
            value = dict(STATE)
        value.update(stamp=stamp(), pid=os.getpid(), parent_pid=os.getppid(),
                     process_group=os.getpgrp(), session_id=os.getsid(0),
                     log='comparisons/ledger-hard/detached-supervisor.log')
        cell = value.get('cell')
        if cell:
            try:
                value['cell_state'] = json.loads((HERE / cell / 'run-state.json').read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                value['cell_state'] = 'state update in progress'
        temp = HERE / 'supervisor-state.tmp'
        temp.write_text(json.dumps(value, indent=2) + '\n')
        os.replace(temp, HERE / 'supervisor-state.json')
        print(json.dumps(value), flush=True)
        FINISHED.wait(30)


def call(args):
    result = subprocess.run(args, cwd=ROOT, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True)
    print(result.stdout, flush=True)
    if result.returncode:
        raise RuntimeError(f'Command failed ({result.returncode}): {args}')


def verify():
    path = HERE / 'supervisor-amendment.json'
    assert subprocess.check_output(['git', 'show', 'HEAD:comparisons/ledger-hard/supervisor-amendment.json'], cwd=ROOT) == path.read_bytes()
    for name, expected in json.loads(path.read_text())['source_sha256'].items():
        assert digest(HERE / name) == expected, name
    return n.verify_runtime()


def main():
    # The launcher creates a new OS session with closed stdin and file-backed logs.
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    signal.signal(signal.SIGTERM, lambda *_: n.STOP.set())
    signal.signal(signal.SIGINT, lambda *_: n.STOP.set())
    with (HERE / 'detached-supervisor.lock').open('a') as own:
        fcntl.flock(own, fcntl.LOCK_EX | fcntl.LOCK_NB)
        threading.Thread(target=heartbeat, daemon=True).start()
        while True:
            try:
                policy = verify()
                if (HERE / 'network-hold').exists():
                    state('operator hold; no paid calls')
                    time.sleep(30)
                    continue
                n.STOP.clear()
                complete = True
                with (HERE / 'network-runner.lock').open('a') as paid:
                    fcntl.flock(paid, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    for cell in policy['model_order']:
                        state('running or waiting through provider gate', cell=cell, error=None)
                        if len(n.r.answers(HERE / cell)) < 6560:
                            if not n.run_cell(cell):
                                complete = False
                                current = json.loads((HERE / cell / 'run-state.json').read_text())
                                state('waiting; no paid calls until guards permit', cell=cell,
                                      reason=current.get('stop_reason'))
                                break
                        for experiment in ('primary', 'dialect'):
                            call([str(ROOT.parent.parent / 'node_modules/.bin/tsx'),
                                  str(HERE / 'extended-peer-parity.mts'), cell,
                                  *(['--dialect'] if experiment == 'dialect' else [])])
                        call(['python3', str(HERE / 'extended-score.py'), cell, '--require-complete'])
                        call(['python3', str(HERE / 'verify-extended.py'), cell])
                if complete:
                    state('verifying and publishing', cell=None)
                    call(['python3', str(HERE / 'network-finish.py')])
                    final = json.loads((HERE / 'network-finish-state.json').read_text())
                    assert final['status'] == 'complete'
                    state('complete', cell=None, commit=final['commit'])
                    FINISHED.set()
                    dump(HERE / 'supervisor-state.json', {
                        'stamp': stamp(), 'pid': os.getpid(), 'phase': 'complete',
                        'commit': final['commit'], 'finish_state': final})
                    print(json.dumps({'stamp': stamp(), 'complete': True, 'commit': final['commit']}), flush=True)
                    return
                # Caps, cutoff, integrity defects and unknown receipts remain blocked.
                # They never trigger an unapproved replay or a supervisor exit.
                time.sleep(60)
            except Exception:
                error = traceback.format_exc()
                print(error, flush=True)
                state('waiting for recovery or attention; no new paid calls', error=error)
                time.sleep(60)


if __name__ == '__main__':
    main()
