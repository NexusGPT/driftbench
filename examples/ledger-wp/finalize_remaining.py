"""Watch this writing run, verify its terminal artifacts, and push its checkpoint."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
LEDGER = Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/spend-ledger.md')
TARGET = int(sys.argv[1])
STATUS = HERE / 'runtime/finalizer-state.json'


def state(status, **extra):
    STATUS.write_text(json.dumps({'status': status, 'pid': os.getpid(), 'targetPid': TARGET,
        'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), **extra}, indent=2) + '\n')


def run(args):
    result = subprocess.run(args, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    print(result.stdout, flush=True)
    result.check_returncode()
    return result.stdout.strip()


def main():
    state('watching', stopCondition='Target driver reaches a terminal state and exits; finalize once, then exit.')
    while True:
        current = json.loads((HERE / 'results/run-state.json').read_text())
        if current['pid'] != TARGET:
            raise RuntimeError('Target run replaced; watcher will not touch another run')
        process = subprocess.run(['ps', '-p', str(TARGET), '-o', 'command='], text=True,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if process.returncode not in (0, 1):
            raise RuntimeError(process.stdout)
        alive = process.returncode == 0 and str(HERE / 'run_remaining.py') in process.stdout
        if not alive:
            if current['status'] not in ('complete', 'stopped'):
                raise RuntimeError('Driver exits without a terminal record; manual reconciliation required')
            break
        time.sleep(25)
    state('finalizing', runStatus=current['status'])
    if run(['git', 'branch', '--show-current']) != 'research/ledger-wp':
        raise RuntimeError('Unexpected branch')
    for script in ['stats.py', 'phase_report.py', 'validity_report.py', 'report.py']:
        run(['python3', str(HERE / script)])
    verification = ['python3', str(HERE / 'verify_results.py')]
    if current['status'] == 'complete':
        verification.append('--require-complete')
    run(verification)
    result = json.loads((HERE / 'results/verification.json').read_text())
    assert not result['failures']
    terminal_at = current['at']
    marker = f'ledger-wp terminal run {terminal_at}'
    if marker not in LEDGER.read_text():
        with LEDGER.open('a') as out:
            out.write(f"\n| {datetime.datetime.now(datetime.timezone.utc).isoformat()} | {marker} | "
                f"Recorded spend {result['actualUsd']:.8f} USD; unresolved holds {result['uncertainOrInflightUsd']:.8f} USD; "
                f"cap 35 USD. Full phase coverage: {result['complete']}. "
                f"Source hashes {result['sourceHashes']}, seals {result['sealHashes']}, verification failures 0. | "
                "No new paid calls; terminal checkpoint |\n")
    run(['git', 'add', 'examples/ledger-wp'])
    staged = run(['git', 'diff', '--cached', '--name-only'])
    if staged:
        if any(not name.startswith('examples/ledger-wp/') for name in staged.splitlines()):
            raise RuntimeError('Staged paths outside owned benchmark')
        run(['git', 'commit', '-m', 'Record terminal sealed writing comparison and spending audit'])
    run(['git', 'push', 'origin', 'research/ledger-wp'])
    head = run(['git', 'rev-parse', 'HEAD'])
    remote = run(['git', 'ls-remote', '--refs', 'origin', 'research/ledger-wp']).split()[0]
    if head != remote:
        raise RuntimeError('Remote hash mismatch')
    state('pushed', runStatus=current['status'], complete=result['complete'], commit=head,
          actualUsd=result['actualUsd'], unresolvedUsd=result['uncertainOrInflightUsd'])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        state('failed', error=str(error))
        raise
