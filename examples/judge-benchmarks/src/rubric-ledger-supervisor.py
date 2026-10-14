"""Detached, single-writer Sol then Sonnet continuation. No Gemini execution path."""
import datetime
import fcntl
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

WORKTREE = Path(__file__).resolve().parents[3]
BASE = WORKTREE / '.cache/ledger-rb'
ROOT = WORKTREE / 'examples/judge-benchmarks/experiments/ledger-rb'
STATE = BASE / 'supervisor-state.json'
PAUSE = BASE / 'supervisor-owner-pause'
MODELS = [('gpt-6.1-sol', 'sol', 50, 'rubric-ledger-added-network.ts'),
          ('claude-sonnet-5-5', 'sonnet', 67, 'rubric-ledger-sonnet-network.ts')]
TARGETS = {'pilot': 40, 'fixtures': 198, 'noise': 90, 'validity': 100, 'test': 1580}


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def atomic(path, value):
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    temp.replace(path)


def rows(folder, stem):
    return [json.loads(line) for path in sorted(folder.glob(stem + '-*.jsonl'))
            for line in path.read_text().splitlines() if line.strip()]


def append_call(folder, row):
    data = (json.dumps(row, separators=(',', ':')) + '\n').encode()
    files = sorted(folder.glob('calls-*.jsonl'))
    target = files[-1] if files else folder / 'calls-000.jsonl'
    size = target.stat().st_size if target.exists() else 0
    if size + len(data) > 8 * 1024 * 1024:
        target = folder / ('calls-%03d.jsonl' % (int(target.stem.split('-')[-1]) + 1))
    with target.open('ab') as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())


def group_members(pgid):
    output = subprocess.run(['ps', '-axo', 'pid=,pgid='], capture_output=True, text=True, check=True).stdout
    return [int(a) for a, b in (line.split() for line in output.splitlines()) if int(b) == pgid]


def recover_missing(model):
    """Called only with no live child group. Existing answers and holds stay intact."""
    folder = ROOT / model / 'live'
    starts = rows(folder, 'starts')
    calls = rows(folder, 'calls')
    completed = {r['key'] for r in calls}
    missing = [r for r in starts if r['key'] not in completed]
    for start in missing:
        identity = start['identity']
        append_call(folder, {'key': start['key'], 'model': model, 'item': identity['item'],
            'contestant': identity['contestant'], 'identity': identity, 'text': '', 'status': 'error',
            'costUsd': start['reserveUsd'], 'costBasis': 'reservation', 'retryable': True,
            'error': 'Runner no longer exists; no completion survived. Reservation retained; missing-only transport recovery.',
            'completedAt': now(), 'completionTimestampKind': 'reconciliation time; actual termination time unknown'})
    return len(missing)


def completed_decisions(model, phase):
    latest = {}
    for row in rows(ROOT / model, 'decisions-' + phase):
        key = (row['model'], row['phase'], row['id'], row['contestant'], row['sample'])
        latest[key] = row
    return sum(r['status'] != 'transport-error' for r in latest.values())


class Supervisor:
    def __init__(self):
        self.state = {'pid': os.getpid(), 'pgid': os.getpgrp(), 'status': 'starting',
            'target': 'Sol then Sonnet, validity, sealed TEST once, reports and verified pushes',
            'paidConcurrency': 2, 'oneCellAtATime': True, 'gemini38': 'dropped; no execution path'}

    def event(self, **values):
        self.state.update(values)
        self.state['at'] = now()
        atomic(STATE, self.state)
        print(json.dumps(self.state), flush=True)

    def sleep(self, seconds, reason):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.event(status='waiting', reason=reason, nextCheckSeconds=min(60, round(deadline-time.monotonic())))
            time.sleep(min(60, max(0, deadline-time.monotonic())))

    def honor_pause(self, alias):
        while PAUSE.exists() or (BASE / (alias + '-owner-pause')).exists():
            self.sleep(60, 'Owner pause file present; no new paid call')

    def run(self, model, alias, phase, command, paid=False):
        while True:
            self.honor_pause(alias)
            prior_group = self.state.get('childPgid')
            while prior_group and group_members(prior_group):
                self.sleep(60, 'Prior child process group still alive; no overlapping continuation')
            if paid and completed_decisions(model, phase) == TARGETS[phase]:
                self.event(model=model, phase=phase, status='phase already complete', childPid=None)
                return
            if paid:
                recovered = recover_missing(model)
                if recovered:
                    self.event(model=model, phase=phase, status='recovered unfinished reservations', recovered=recovered)
            path = BASE / f'supervisor-{alias}-{phase}.log'
            with path.open('a') as log:
                child = subprocess.Popen(command, cwd=WORKTREE, stdin=subprocess.PIPE,
                    stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                child.stdin.close()
                self.event(model=model, phase=phase, status='running', childPid=child.pid,
                           childPgid=child.pid, phaseLog=str(path), reason=None)
                while child.poll() is None:
                    time.sleep(30)
                    self.event(status='running', completedDecisions=completed_decisions(model, phase) if paid else None)
                code = child.returncode
            # A launcher exit must not overlap an orphaned child with a retry.
            while group_members(child.pid):
                self.sleep(60, 'Prior child process group still alive; wait before any retry')
            self.event(status='command finished', childPid=None, childPgid=None, exitCode=code)
            if code == 0 and (not paid or completed_decisions(model, phase) == TARGETS[phase]):
                return
            # Outages, native session limits, hard budget stops and other gates all wait.
            # A later retry replays every saved answer. No gate is bypassed.
            self.sleep(600, f'{alias}/{phase} returned {code}; wait, then retry the same missing-only phase')

    def checked(self, model, alias, label, action):
        while True:
            self.honor_pause(alias)
            try:
                return action()
            except Exception as error:
                self.event(model=model, phase=label, status='waiting for gate', reason=str(error), childPid=None)
                self.sleep(600, label + ': ' + str(error))

    def git(self, model, alias, label, title):
        relative = str((ROOT / model).relative_to(WORKTREE))
        def commit():
            branch = subprocess.run(['git', 'branch', '--show-current'], cwd=WORKTREE,
                capture_output=True, text=True, check=True).stdout.strip()
            if branch != 'research/ledger-rb':
                raise RuntimeError('Wrong branch; no git mutation')
            staged = subprocess.run(['git', 'diff', '--cached', '--name-only'], cwd=WORKTREE,
                capture_output=True, text=True, check=True).stdout.splitlines()
            if any(not p.startswith(relative + '/') for p in staged):
                raise RuntimeError('Other paths staged; wait for owner inspection')
            subprocess.run(['git', 'add', relative], cwd=WORKTREE, check=True)
            subprocess.run(['git', 'diff', '--cached', '--check'], cwd=WORKTREE, check=True)
            staged = subprocess.run(['git', 'diff', '--cached', '--name-only'], cwd=WORKTREE,
                capture_output=True, text=True, check=True).stdout.splitlines()
            if staged:
                subprocess.run(['git', 'commit', '-m', title], cwd=WORKTREE, check=True)
        self.checked(model, alias, label + '-commit', commit)
        self.run(model, alias, label + '-push', ['git', 'push', 'origin', 'research/ledger-rb'])
        def verify():
            head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=WORKTREE, capture_output=True, text=True, check=True).stdout.strip()
            remote = subprocess.run(['git', 'ls-remote', '--heads', 'origin', 'research/ledger-rb'], cwd=WORKTREE,
                capture_output=True, text=True, check=True).stdout.split()[0]
            if head != remote:
                raise RuntimeError('Remote SHA differs; wait and inspect')
            return head
        return self.checked(model, alias, label + '-remote', verify)

    def cell(self, model, alias, cap, source):
        folder = ROOT / model
        runner = ['pnpm', 'exec', 'tsx', '--no-cache', 'examples/judge-benchmarks/src/' + source, '--model', model, '--phase']
        for phase in ['pilot', 'fixtures', 'noise', 'validity']:
            self.run(model, alias, phase, runner + [phase, '--execute'], paid=True)
        self.run(model, alias, 'pretest-report', runner + ['report'])
        if not (folder / 'test-run-seal.json').exists():
            self.run(model, alias, 'seal-test', runner + ['seal-test'])
        def gate():
            seal = json.loads((folder / 'test-run-seal.json').read_text())
            if not seal['allowTest'] or seal['projectedTotalUsd'] > cap or seal['capUsd'] != cap:
                raise RuntimeError('Sealed validity or hard budget gate does not pass')
        self.checked(model, alias, 'TEST-gate', gate)
        self.run(model, alias, 'pretest-scan', ['node', '.cache/ledger-rb/scan-recordings.mjs', str(folder/'pretest-content-scan.json'), str(folder)])
        self.git(model, alias, 'pretest', 'Seal ' + model + ' RubricBench TEST after validity and budget gates')
        self.run(model, alias, 'test', runner + ['test', '--execute'], paid=True)
        self.run(model, alias, 'report', runner + ['report'])
        self.run(model, alias, 'token-audit', ['python3', '.cache/ledger-rb/audit-token-loss.py', str(folder), model])
        self.run(model, alias, 'integrity', ['python3', f'.cache/ledger-rb/verify-{alias}-final.py'])
        self.run(model, alias, 'write-report', ['python3', f'.cache/ledger-rb/write-{alias}-final.py'])
        self.run(model, alias, 'final-scan', ['node', '.cache/ledger-rb/scan-recordings.mjs', str(folder/'final-content-scan.json'), str(folder)])
        head = self.git(model, alias, 'final', 'Record complete ' + model + ' RubricBench cell and evidence')
        atomic(BASE / (alias + '-finish-driver.json'), {'pid': os.getpid(), 'status': 'complete', 'phase': 'done', 'model': model, 'pushedCommit': head, 'at': now()})
        self.event(model=model, phase='done', status='cell complete', pushedCommit=head)

    def main(self):
        # A retained child group from a crashed supervisor must drain before recovery.
        if STATE.exists():
            prior = json.loads(STATE.read_text())
            pgid = prior.get('childPgid')
            self.state['childPgid'] = pgid
            while pgid and group_members(pgid):
                self.sleep(60, 'Prior supervisor child group still alive')
        self.event()
        def verify_runtime():
            path = ROOT / 'detached-runtime-amendment.json'
            relative = str(path.relative_to(WORKTREE))
            committed = subprocess.run(['git', 'show', 'HEAD:' + relative], cwd=WORKTREE,
                capture_output=True, check=True).stdout
            if committed != path.read_bytes():
                raise RuntimeError('Detached runtime amendment is not committed')
            for name, digest in json.loads(committed)['hashes'].items():
                if hashlib.sha256((WORKTREE / name).read_bytes()).hexdigest() != digest:
                    raise RuntimeError('Detached continuation source changed: ' + name)
        self.checked('gpt-6.1-sol', 'sol', 'runtime-freeze', verify_runtime)
        for args in MODELS:
            self.checked(args[0], args[1], 'cell continuation', lambda: self.cell(*args))
        self.event(status='complete', phase='done', childPid=None, childPgid=None)


if __name__ == '__main__':
    os.chdir(WORKTREE)
    BASE.mkdir(parents=True, exist_ok=True)
    lock = (BASE / 'supervisor.lock').open('a+')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit('An owned supervisor is already active; no duplicate started')
    signal.signal(signal.SIGHUP, signal.SIG_IGN)
    Supervisor().main()
