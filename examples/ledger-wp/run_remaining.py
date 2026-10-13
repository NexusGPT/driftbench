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
    freeze = json.loads((HERE / 'freeze.json').read_text())
    reset = datetime.datetime.fromisoformat(freeze.get('geminiDailyQuotaAmendment', {}).get('resumeNotBefore', '1970-01-01T00:00:00Z'))
    quota_blocked = datetime.datetime.now(datetime.timezone.utc) < reset
    models = sys.argv[1] if len(sys.argv)>1 else ','.join(model for model in freeze['models']
        if model != 'gemini-3.8-flash' or (not freeze.get('geminiOwnerHold', {}).get('active') and not freeze.get('geminiCreditHold', {}).get('active') and not quota_blocked))
    limits = {model: freeze.get('additionalModelCells', {}).get(model, {}).get('maxConcurrentCalls', freeze['pacingAmendment']['maxConcurrentCalls'].get(model)) for model in models.split(',')}
    state('running', 'remaining', models=models, limits=limits)
    env = dict(os.environ)
    # Credentials exist only in this invocation's environment, never in the logs.
    env['OPENAI_API_KEY'] = (Path.home() / '.nexus-secrets/openai.key').read_text().strip()
    env['GEMINI_API_KEY'] = (Path.home() / '.nexus-secrets/gemini-driftbench.key').read_text().strip()
    env['SHIM_USAGE_LOG'] = str(HERE / 'results/provider-usage.jsonl')
    env['TMPDIR'] = str(HERE / 'runtime')
    with (HERE / 'runtime/remaining-per-model.log').open('a') as log:
        result = subprocess.run(['node', '--import', 'tsx', str(HERE / 'harness.ts'), '--phase', 'remaining',
                                 '--model-concurrency', json.dumps(limits), '--model', models],
                                cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    del env
    reports()
    if result.returncode:
        state('stopped', 'remaining', exitCode=result.returncode, models=models, limits=limits)
        raise SystemExit(result.returncode)
    subprocess.run(['python3', str(HERE / 'verify_results.py'), '--require-complete', '--models', models], cwd=ROOT, check=True)
    state('complete', 'test', models=models)


if __name__ == '__main__':
    main()
