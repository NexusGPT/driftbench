"""Resume this parked Gemini queue after the owner-authorized daily reset."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TARGET = int(sys.argv[1])
STATE = HERE / 'runtime/gemini-reset-watcher-state.json'


def state(status, **extra):
    STATE.write_text(json.dumps({'pid': os.getpid(), 'targetPid': TARGET, 'status': status,
        'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), **extra}, indent=2) + '\n')


def load(path):
    return json.loads((HERE / path).read_text())


def main():
    freeze = load('freeze.json')
    reset = datetime.datetime.fromisoformat(freeze['geminiDailyQuotaAmendment']['resumeNotBefore'])
    cutoff = datetime.datetime.fromisoformat(freeze['modelLastCallUtc']['gemini-3.8-flash'])
    state('armed', resumeNotBefore=reset.isoformat(), lastCallUtc=cutoff.isoformat(),
          stopCondition='One missing-only Gemini run after reset, followed by verification and push; then exit.')
    while True:
        current = load('results/run-state.json')
        if current['pid'] != TARGET:
            state('retired', reason='Another run replaces the parked target; no second runner started.')
            return
        now = datetime.datetime.now(datetime.timezone.utc)
        if now >= cutoff:
            state('expired', reason='Gemini last-call cutoff passes before safe resumption.')
            return
        if now >= reset:
            terminal = load('runtime/finalizer-state.json')
            if current['status'] in ('complete', 'stopped') and terminal['status'] == 'pushed' and terminal['targetPid'] == TARGET:
                break
        time.sleep(30)
    branch = subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip()
    if branch != 'research/ledger-wp':
        raise RuntimeError('Unexpected branch')
    subprocess.run(['python3', str(HERE / 'verify_results.py')], cwd=ROOT, check=True)
    with (HERE / 'runtime/gemini-reset-run.log').open('a') as run_log, (HERE / 'runtime/gemini-reset-finalizer.log').open('a') as finish_log:
        runner = subprocess.Popen(['python3', str(HERE / 'run_remaining.py'), 'gemini-3.8-flash'],
                                  cwd=ROOT, stdout=run_log, stderr=subprocess.STDOUT, start_new_session=True)
        # Wait for this driver's own authoritative start record before arming its finisher.
        for _ in range(30):
            if load('results/run-state.json')['pid'] == runner.pid:
                break
            if runner.poll() is not None:
                raise RuntimeError('Gemini runner exits before its start record')
            time.sleep(1)
        else:
            raise RuntimeError('Gemini runner does not publish its start record')
        finisher = subprocess.Popen(['python3', str(HERE / 'finalize_remaining.py'), str(runner.pid)],
                                   cwd=ROOT, stdout=finish_log, stderr=subprocess.STDOUT, start_new_session=True)
        state('running', runnerPid=runner.pid, finalizerPid=finisher.pid)
        runner.wait()
        finisher.wait()
    final = load('runtime/finalizer-state.json')
    state('finished' if final['status'] == 'pushed' else 'failed', finalization=final)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        state('failed', error=str(error))
        raise
