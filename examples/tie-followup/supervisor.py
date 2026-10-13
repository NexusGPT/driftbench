"""Detached, bounded experiment driver. Inputs and receipts remain outside git."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

data, records, code, results, notes = map(Path, sys.argv[1:])
records.mkdir(parents=True, exist_ok=True)

def stamp():
    return datetime.now(timezone.utc).isoformat()

def event(kind, **values):
    row = dict(at=stamp(), pid=os.getpid(), event=kind, **values)
    with (records / 'supervisor.jsonl').open('a') as f:
        f.write(json.dumps(row) + '\n')
        f.flush()
        os.fsync(f.fileno())
    print(json.dumps(row), flush=True)

def run(args, cwd=code):
    process = subprocess.Popen(args, cwd=cwd)
    event('child', childPid=process.pid, command=args[0], mode=args[4] if len(args)>4 else '')
    status = process.wait()
    if status:
        raise RuntimeError(f'Command exited {status}: {args[0]}')

def experiment(mode):
    # The global reservation ledger bounds every physical submission before it starts.
    event('run-reservation', mode=mode, taskCapUsd=40, accounting='spend.jsonl, actual plus unresolved holds')
    run(['node', '--import', 'tsx', str(results/'experiment.ts'), mode, str(data), str(records), str(code), str(results)])

def append_note(text):
    with notes.open('a') as f:
        f.write('\n' + text + '\n')
        f.flush()
        os.fsync(f.fileno())

event('started', codeCommit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=code,text=True).strip())
append_note(f'## Detached supervisor\n- PID: {os.getpid()}. Started {stamp()}.\n- Receipts: {records}.\n- Log: {records / "supervisor.log"}.')
try:
    experiment('dev')
    experiment('freeze')
    freeze = results/'frozen-choice.json'
    digest = hashlib.sha256(freeze.read_bytes()).hexdigest()
    choice = json.loads(freeze.read_text())
    append_note(f'## Choice frozen before fresh calls\n- Variant: {choice["variant"]}.\n- SHA-256: {digest}.\n- File: {freeze}.\n- Dev results: {results / "dev-results.json"}.')
    repo = results.parent.parent
    run(['git','add','--','examples/tie-followup/frozen-choice.json','examples/tie-followup/frozen-choice.json.sha256','examples/tie-followup/dev-results.json','examples/tie-followup/dev-spend.json'], repo)
    run(['git','commit','-m','research: freeze tie follow-up choice on dev\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'], repo)
    run(['git','push','origin','research/tie-followup'], repo)
    event('freeze-committed', sha256=digest, variant=choice['variant'])
    experiment('fresh')
    experiment('report')
    event('complete')
    append_note(f'## Measurement ended\n- Completed {stamp()}.\n- Fresh results: {results / "heldout-results.json"}.\n- Spending: {results / "fresh-spend.json"}.')
except Exception as error:
    event('stopped', reason=str(error))
    append_note(f'## Supervisor stopped\n- {stamp()}: {error}.\n- Returned answers remain recorded and cannot be resent. No automatic session-limit restart.')
    if (results/'frozen-choice.json').exists():
        try:
            experiment('report')
        except Exception as report_error:
            event('report-error', reason=str(report_error))
    sys.exit(1)
