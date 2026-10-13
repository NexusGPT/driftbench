"""Recover only the three authorized TEST timeouts, preserving every initial verdict."""
import concurrent.futures
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
STATE = BASE / 'evidence/haiku-test-timeout-recovery.json'
CACHE = BASE / 'cache/haiku-test-outage'


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(**value):
    STATE.write_text(json.dumps(dict(at=now(), pid=os.getpid(), **value), indent=2) + '\n')
    print(json.dumps(value), flush=True)


def archive(path, target):
    content = path.read_bytes()
    if target.exists():
        assert target.read_bytes() == content
    else:
        target.write_bytes(content)
    return content


def main():
    amendment = json.loads((BASE / 'evidence/haiku-test-timeouts.json').read_text())
    requests = json.loads((CACHE / 'requests.json').read_text())
    assert len(requests) == len(amendment['calls']) == 3
    assert {r['fingerprint'] for r in requests} == {r['fingerprint'] for r in amendment['calls']}
    assert amendment['maxAdditionalSubmissionsEach'] == 1
    source = (BASE / 'transport.ts').read_text()
    original_source_hash = digest(source.encode())

    def replace(old, new):
        nonlocal source
        assert source.count(old) == 1, old
        source = source.replace(old, new)

    replace('import { appendFile, mkdir, readFile }', 'import { appendFile, mkdir, readFile, writeFile }')
    replace('  callFingerprint=fingerprint(freeze.coreSha);', '''  callFingerprint=fingerprint(freeze.coreSha);
  const recovery=JSON.parse(await readFile(resolve(base,'evidence/haiku-test-timeouts.json'),'utf8'));
  if(model!=='haiku'||process.env.VERIFY_PHASE!=='test'||!recovery.calls.some((r:any)=>r.fingerprint===callFingerprint))throw new Error('Outside authorized TEST timeout recovery');
  const excludedIds=new Set(recovery.calls.map((r:any)=>r.id));''')
    replace('.find(r=>!', '.find(r=>!excludedIds.has(r.id)&&!')
    replace("  await acquire();\n  budget('reserve'", """  await writeFile(resolve(base,'cache/haiku-test-outage',callFingerprint+'.claim.json'),JSON.stringify({id,at:new Date().toISOString(),fingerprint:callFingerprint}),{flag:'wx'});
  await acquire();
  budget('reserve'""")
    generated = BASE / 'haiku-test-timeout-transport.generated.ts'
    generated.write_text(source)
    execution = dict(authorization=amendment['authorization'], originalTransportSha256=original_source_hash,
                     recoveryTransportSha256=digest(source.encode()), maxAdditionalSubmissionsEach=1,
                     unknownHoldsRetainedUsd=1.5, requests=[dict(key=r['key'], fingerprint=r['fingerprint']) for r in requests])
    (BASE / 'evidence/haiku-test-timeout-execution.json').write_text(json.dumps(dict(at=now(), **execution), indent=2) + '\n')
    if '--prepare-only' in sys.argv:
        print(json.dumps(dict(status='prepared offline', requests=3)))
        return
    save(status='waiting for initial TEST and its offline report', stop='three authorized submissions finish or a guard fails')
    while True:
        try:
            progress = json.loads((BASE / 'haiku.progress.json').read_text())
            finalizer = json.loads((BASE / 'evidence/finalizer-state.json').read_text())
            ready = progress.get('phase') == 'all' and progress.get('status') == 'complete'
            ready = ready and finalizer.get('status') in ['offline evidence ready for review', 'offline verification failed']
        except (FileNotFoundError, json.JSONDecodeError):
            ready = False
        if ready:
            break
        time.sleep(15)
    report = BASE / 'results/haiku.json'
    runtime = json.loads((BASE / 'evidence/runtime-freeze.json').read_text())
    cassette = BASE / 'recordings' / runtime['recordingsId'] / 'test/longjudge-verify/haiku.jsonl'
    report_bytes = archive(report, report.with_name('haiku.pre-test-timeout-recovery.json'))
    cassette_bytes = archive(cassette, cassette.with_name('haiku.pre-test-timeout-recovery.jsonl'))
    initial = json.loads(report_bytes)
    assert not initial.get('stopped') and initial['items'] == 221
    assert all(len(c['decisions']) == 221 for c in initial['contestants'])
    for call in amendment['calls']:
        native = Path(call['nativeReceipt'])
        assert native.exists() and not native.read_text().strip(), 'A late native answer must never be retried'
    env = dict(os.environ)
    for name in ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'VERIFY_OPENAI_KEY_FILE', 'VERIFY_GEMINI_KEY_FILE']:
        env.pop(name, None)
    env['TMPDIR'] = str(ROOT / '.tmp')
    env['VERIFY_PHASE'] = 'test'
    probe = subprocess.run(['node', '--input-type=module', '-e',
        "import dns from 'node:dns/promises'; await dns.lookup('api.anthropic.com'); const r=await fetch('https://api.anthropic.com/',{signal:AbortSignal.timeout(20000)}); console.log(JSON.stringify({at:new Date().toISOString(),host:'api.anthropic.com',status:r.status,dns:true,http:true}));"],
        cwd=ROOT, env=env, text=True, capture_output=True, check=True)
    if probe.stderr:
        print(probe.stderr, file=sys.stderr)
    probe_value = json.loads(probe.stdout)
    (BASE / 'evidence/haiku-test-timeout-connectivity.json').write_text(json.dumps(probe_value, indent=2) + '\n')
    tsx = [str(ROOT / 'node_modules/.bin/tsx'), '--tsconfig', 'examples/ledger-verify/tsconfig.json']
    before = {r['id'] for r in map(json.loads, (BASE / 'receipts/calls.jsonl').read_text().splitlines())}
    save(status='recovering three authorized no-answer calls', **execution)

    def retry(request):
        path = CACHE / (request['fingerprint'] + '.response.json')
        if path.exists():
            response = json.loads(path.read_text())
        else:
            value = subprocess.run(tsx + [str(generated), '--model', 'haiku', '--system-prompt', request['prompt']['system']],
                input=request['prompt']['user'], text=True, capture_output=True, cwd=ROOT, env=env, check=True)
            if value.stderr:
                (CACHE / (request['fingerprint'] + '.stderr.log')).write_text(value.stderr)
            response = json.loads(value.stdout)
            path.write_text(json.dumps(response) + '\n')
        assert not str(response.get('result', '')).startswith('Transport limit:'), response.get('result')
        return dict(key=request['key'], fingerprint=request['fingerprint'], labels=request['labels'],
                    isError=response.get('is_error', False), costUsd=response.get('total_cost_usd', 0),
                    use='supplemental only; initial final verdict and complete request history preserved')

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        recovered = list(pool.map(retry, requests))
    assert report.read_bytes() == report_bytes and cassette.read_bytes() == cassette_bytes
    receipts = [r for r in map(json.loads, (BASE / 'receipts/calls.jsonl').read_text().splitlines()) if r['id'] not in before]
    assert all(r['model'] == 'haiku' and r['fingerprint'] in {x['fingerprint'] for x in requests} for r in receipts)
    save(status='complete', **execution, outcomes=recovered, newReceiptIds=[r['id'] for r in receipts],
         newSettledUsd=sum(r['costUsd'] for r in receipts), primaryReportSha256=digest(report_bytes),
         primaryCassetteSha256=digest(cassette_bytes), initialDecisionsPreserved=442,
         primaryResultsReplaced=0, returnedAnswersResent=0)
    with (BASE / 'logs/haiku-test-timeout-finalize.log').open('w') as log:
        subprocess.run(['python3', 'examples/ledger-verify/finish.py', '--allow-daily-quota'],
                       cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)


if __name__ == '__main__':
    main()
