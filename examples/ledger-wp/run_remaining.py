"""Run the authorized sealed phases sequentially, surviving a client disconnect."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def state(status, phase, **extra):
    (HERE / 'results/run-state.json').write_text(json.dumps({
        'pid': os.getpid(), 'status': status, 'phase': phase,
        'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), **extra,
    }, indent=2) + '\n')


def reports():
    for name in ['stats.py', 'phase_report.py', 'validity_report.py', 'report.py', 'verify_results.py']:
        with (HERE / 'runtime' / (name + '.log')).open('w') as log:
            subprocess.run(['python3', str(HERE / name)], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)


def main():
    models = sys.argv[1] if len(sys.argv)>1 else 'haiku,gpt-6-luna'
    concurrency = '2' if 'gemini-3.8-flash' in models else '4'
    for phase in ['fixtures', 'validity', 'dev', 'test']:
        if phase == 'test':
            reports()
            checks = json.loads((HERE / 'results/phase-report.json').read_text())
            edits = json.loads((HERE / 'results/validity-checks.json').read_text())
            disposition = {
                'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'authorization': 'Resume the writing cell: run the full 173-pair TEST on the sealed pool. Your cap is 35 USD.',
                'policy': 'Execute the explicitly authorized full test without tuning. Report failed validity checks and withhold any general validation claim they do not support.',
                'fixtureAndCheaterChecks': [{k: row.get(k) for k in ['model', 'contestant', 'earnedFixtureSeat', 'cheaterBarPass', 'noise']} for row in checks['dev']],
                'editChecks': edits['cells'],
                'modelScope': models,
            }
            (HERE / 'results/pretest-disposition.json').write_text(json.dumps(disposition, indent=2) + '\n')
        state('running', phase, models=models, concurrency=int(concurrency))
        env = dict(os.environ)
        # Credentials exist only in this invocation's environment, never in the logs.
        env['OPENAI_API_KEY'] = (Path.home() / '.nexus-secrets/openai.key').read_text().strip()
        env['GEMINI_API_KEY'] = (Path.home() / '.nexus-secrets/gemini-driftbench.key').read_text().strip()
        env['SHIM_USAGE_LOG'] = str(HERE / 'results/provider-usage.jsonl')
        env['TMPDIR'] = str(HERE / 'runtime')
        with (HERE / 'runtime' / (phase + '-remaining.log')).open('a') as log:
            result = subprocess.run(['node', '--import', 'tsx', str(HERE / 'harness.ts'), '--phase', phase, '--concurrency', concurrency, '--model', models],
                                    cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        del env
        reports()
        if result.returncode:
            state('stopped', phase, exitCode=result.returncode, models=models)
            raise SystemExit(result.returncode)
    subprocess.run(['python3', str(HERE / 'verify_results.py'), '--require-complete', '--models', models], cwd=ROOT, check=True)
    state('complete', 'test', models=models)


if __name__ == '__main__':
    main()
