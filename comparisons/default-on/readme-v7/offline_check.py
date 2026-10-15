"""No-network check of the README v7 run: every dataset's request shape goes through the frozen driver and analyze.py.

Usage: offline_check.py <manifest.json> <driver dir> <product judges/src> <tsx> <scratch dir>
Two items per dataset, a fake Messages API, an isolated budget journal. Prints one JSON line; exits non-zero on failure.
"""
import json, os, subprocess, sys
from pathlib import Path

manifest_path, driver, product, tsx, scratch = (Path(a) for a in sys.argv[1:6])
scratch.mkdir(parents=True, exist_ok=False)
m = json.loads(manifest_path.read_text())
small = {**m, 'datasets': [{**d, 'items': d['items'][:2]} for d in m['datasets']]}
keep = {(d['name'], i['id']) for d in small['datasets'] for i in d['items']}
small['rows'] = [{**r, 'peerCorrect': {k: v for k, v in r['peerCorrect'].items() if (r['dataset'], k) in keep},
                  'oldOursCorrect': {k: v for k, v in r['oldOursCorrect'].items() if (r['dataset'], k) in keep}}
                 for r in m['rows']]
(scratch / 'manifest.json').write_text(json.dumps(small))
(scratch / 'fake.mts').write_text('''let n=0;
export async function fetch(url:any,init:any){
 if(String(url)!=='https://api.anthropic.com/v1/messages')throw Error('WRONG_API');
 const b=JSON.parse(init.body);if(b.model!=='claude-haiku-5-5'||!Number.isInteger(b.max_tokens))throw Error('WRONG_PAYLOAD');
 n++;
 const route=b.system.startsWith('Select the evaluation');
 const text=route?JSON.stringify({route:'criterion'}):JSON.stringify({checks:[{id:'fixture',reasoning:'offline fixture',evidence:[],met:true}]});
 return new Response(JSON.stringify({id:'msg_fixture',type:'message',role:'assistant',model:b.model,stop_reason:'end_turn',content:[{type:'text',text}],usage:{input_tokens:10,output_tokens:10}}),{status:200});
}
''')
env = {**os.environ, 'DEFAULT_ON_PRODUCT_ROOT': str(product)}
base = [str(tsx), 'measure-api-v7.mts', '--manifest', str(scratch / 'manifest.json'), '--output', str(scratch / 'run'),
        '--variant', 'new', '--cap-usd', '1', '--workers', '4', '--shared-journal', str(scratch / 'budget.jsonl'),
        '--prior-budget-ledger', str(scratch / 'empty.jsonl'), '--fake-module', str(scratch / 'fake.mts')]
(scratch / 'empty.jsonl').write_text('')
for extra in (['--freeze'], ['--execute']):
    r = subprocess.run(base + extra, cwd=driver, env=env, text=True, capture_output=True, timeout=600)
    if r.returncode != 0:
        print(r.stdout[-2000:], r.stderr[-2000:])
        sys.exit(f'driver {extra[0]} failed: {r.returncode}')
frozen = json.loads(r.stdout.splitlines()[-1])['frozen']
results = [json.loads(l) for l in (scratch / 'run/results.jsonl').read_text().splitlines()]
statuses = {}
for x in results:
    statuses[x['status']] = statuses.get(x['status'], 0) + 1
expected = sum(len(d['items']) for d in small['datasets'])
a = subprocess.run([sys.executable, str(Path(__file__).with_name('analyze.py')), str(scratch / 'manifest.json'),
                    str(scratch / 'run/results.jsonl'), frozen, str(scratch / 'analysis.json')], text=True, capture_output=True)
if a.returncode != 0:
    print(a.stderr[-2000:])
    sys.exit('analyze.py failed')
analysis = json.loads((scratch / 'analysis.json').read_text())
not_returned = [x for x in analysis['notInPairs'] if x['status'] != 'returned']
ok = statuses == {'returned': expected} and len(analysis['rows']) == len(m['rows']) and not not_returned
print(json.dumps({'ok': ok, 'datasets': len(small['datasets']), 'items': expected, 'statuses': statuses,
                  'rows': len(analysis['rows']), 'notReturned': len(not_returned)}))
sys.exit(0 if ok else 1)
