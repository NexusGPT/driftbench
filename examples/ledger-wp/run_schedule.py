"""Hand off the existing Haiku/Luna run to Gemini without overlapping providers."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def record(status, **fields):
    (HERE / 'runtime/schedule-state.json').write_text(json.dumps({
        'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'pid': os.getpid(), 'status': status, **fields,
    }, indent=2) + '\n')


def main():
    predecessor = int(sys.argv[1])
    record('waiting-for-haiku-luna', predecessor=predecessor)
    while True:
        state = json.loads((HERE / 'results/run-state.json').read_text())
        if state.get('pid') != predecessor or state.get('models') != 'haiku,gpt-6-luna':
            raise RuntimeError('Unexpected predecessor; no Gemini calls authorized by this handoff')
        if state['status'] == 'stopped':
            record('stopped-with-predecessor', predecessor=predecessor, state=state)
            return
        if state['status'] == 'complete':
            break
        try:
            os.kill(predecessor, 0)
        except ProcessLookupError:
            record('predecessor-interrupted', predecessor=predecessor, state=state)
            return
        time.sleep(15)
    with (HERE / 'runtime/handoff-verification.log').open('w') as log:
        subprocess.run(['python3', str(HERE / 'verify_results.py'), '--require-complete',
                        '--models', 'haiku,gpt-6-luna'], cwd=ROOT,
                       stdout=log, stderr=subprocess.STDOUT, check=True)
    record('running-gemini', predecessor=predecessor, concurrency=2)
    with (HERE / 'runtime/gemini-driver.log').open('a') as log:
        result = subprocess.run(['python3', str(HERE / 'run_remaining.py'), 'gemini-3.8-flash'],
                                cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
    record('complete' if result.returncode == 0 else 'gemini-stopped',
           predecessor=predecessor, exitCode=result.returncode)


if __name__ == '__main__':
    main()
