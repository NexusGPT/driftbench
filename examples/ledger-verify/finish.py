"""Wait for full execution, then build the offline evidence bundle. No provider calls."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[1]
MODELS = ['haiku', 'gpt-6-luna', 'gemini-3.8-flash']
PHASES = {'pilot': 20, 'validity': 48, 'noise-0': 30, 'noise-1': 30, 'noise-2': 30, 'results': 221}
DOSSIER = Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/codex/dossier-ledger-verify.md')

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def ready():
    for model in MODELS:
        try:
            state = json.loads((BASE / f'{model}.progress.json').read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            # A supervisor can be replacing this small status file at this instant.
            return False
        if state.get('phase') != 'all' or state.get('status') != 'complete':
            return False
    return True

if '--wait' in sys.argv:
    (BASE / 'evidence/finalizer-state.json').write_text(json.dumps({'pid': os.getpid(), 'at': now(), 'status': 'waiting', 'target': 'all three full verify runs', 'stop': 'offline verification finishes or fails'}, indent=2) + '\n')
    while not ready():
        time.sleep(30)
assert ready(), 'The complete sealed runs must finish first'
for model in MODELS:
    for phase, count in PHASES.items():
        report = json.loads((BASE / phase / f'{model}.json').read_text())
        assert report['items'] == count and not report.get('stopped'), (model, phase)
        assert len(report['contestants']) == 2
        assert all(len(c['decisions']) == count for c in report['contestants'])

env = dict(os.environ)
for key in ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'VERIFY_OPENAI_KEY_FILE', 'VERIFY_GEMINI_KEY_FILE']:
    env.pop(key, None)
env['TMPDIR'] = str(ROOT / '.tmp')
commands = [
    [str(ROOT / 'node_modules/.bin/tsx'), '--tsconfig', 'examples/ledger-verify/tsconfig.json', 'examples/ledger-verify/trace-requests.ts', '--all'],
    ['python3', 'examples/ledger-verify/output_limits.py'],
    ['python3', 'examples/ledger-verify/check-replays.py'],
    ['python3', 'examples/ledger-verify/summarize.py'],
    ['python3', 'examples/ledger-verify/render_report.py', str(DOSSIER)],
]
try:
    for index, command in enumerate(commands):
        with (BASE / 'logs' / f'finalize-{index}.log').open('w') as log:
            subprocess.run(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
    limits = json.loads((BASE / 'evidence/output-limit-errors.json').read_text())
    assert not limits['unmappedLimits']
    replay = json.loads((BASE / 'evidence/phase-replay-checks.json').read_text())
    assert len(replay['phases']) == 18 and all(p['identicalDecisions'] and p['newCalls'] == 0 for p in replay['phases'])
    cells = json.loads((BASE / 'evidence/cells.json').read_text())
    assert cells['fees']['maximumAccountedUsd'] <= 40
    cells['cheaterGateAuditFile'] = 'evidence/cheater-gate-audit.json'
    cells['predeclaredCheaterMarginEstablished'] = False
    for cell in cells['cells']:
        cell['validityPassedScope'] = 'Planted mutation checks only; predeclared cheater margin not established'
    (BASE / 'evidence/cells.json').write_text(json.dumps(cells, indent=2) + '\n')
    freeze = json.loads((BASE / 'evidence/scoring-freeze.json').read_text())
    for path, expected in {**freeze['sourceHashes'], **freeze['implementationHashes']}.items():
        assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == expected, path
    supplement = '\n## Execution recovery and validity disclosure\n\n'
    supplement += '- The owner confirms the Gemini top-up. One missing request probe returns an answer for 0.00151125 USD, then missing-only recovery continues at two calls.\n'
    supplement += '- The probe answer is reused without another paid call. Original reports and cassettes are archived; returned answers remain cached.\n'
    supplement += '- Five network no-answer entries and twenty proven billing rejections are eligible for recovery. Unknown network-charge holds remain.\n'
    supplement += '- Gemini recovery keeps medium reasoning, 300-second attempts, quota waits of 60/120/240 seconds and the HTTP 402 circuit break.\n'
    supplement += '- Recovery evidence: evidence/gemini-topup-resume.json and evidence/gemini-topup-recovery-check.json.\n'
    supplement += '- The predeclared ten-point cheater margin is not established. On the same twenty DEV pilot items, constant-fail scores 18/20.\n'
    supplement += '- Product-final cascade scores are Haiku 18/20, Luna 17/20 and Gemini 18/20. These do not clear that pilot baseline by ten points.\n'
    supplement += '- The full 95-item DEV cheater gate is not freshly measured. The validityPassed field in cells.json covers planted mutation checks only.\n'
    supplement += '- This documentation audit occurs after TEST starts. TEST predictions, endpoints and statistical code remain unchanged; no blanket validity or confirmatory superiority claim follows.\n'
    supplement += '- Cheater disclosure source: evidence/cheater-gate-audit.json.\n'
    for path in [BASE / 'REPORT.md', DOSSIER]:
        with path.open('a') as file:
            file.write(supplement)
    result = {'at': now(), 'status': 'offline evidence ready for review', 'phases': 18, 'evaluationUnitsPerModel': 379, 'replayNewCalls': 0, 'unmappedLimits': 0, 'fees': cells['fees']}
    (BASE / 'evidence/finalizer-state.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'fees'}), flush=True)
except Exception as error:
    (BASE / 'evidence/finalizer-state.json').write_text(json.dumps({'at': now(), 'status': 'offline verification failed', 'error': str(error)}, indent=2) + '\n')
    raise
