"""Focused offline checks: hard caps include holds, provider isolation, failure classification."""
import datetime,importlib.util,json,os,tempfile,time
from pathlib import Path
BASE=Path(__file__).resolve().parent
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,BASE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
budget=load('newbudget','new-cell-budget.py');network=load('newnetwork','network-gate.py');retry=load('newretry','transport-retry.py')
with tempfile.TemporaryDirectory(dir=BASE.parents[1]/'.tmp') as td:
 p=Path(td);(p/'evidence').mkdir();budget.__file__=str(p/'new-cell-budget.py');cell=p/'sonnet';(cell/'receipts').mkdir(parents=True)
 gate=p/'evidence/network-admission.json';gate.write_text(json.dumps(dict(open=True,model='claude-sonnet-5-5',lastProbeEpoch=time.time())))
 assert not budget.transact(cell,'try-acquire','wrong',model='gpt-6.1-sol',pid=os.getpid())['acquired']
 for token in ['a','b']:assert budget.transact(cell,'try-acquire',token,model='claude-sonnet-5-5',pid=os.getpid())['acquired']
 assert not budget.transact(cell,'try-acquire','c',model='claude-sonnet-5-5',pid=os.getpid())['acquired']
 budget.transact(cell,'reserve','held',24.9)
 try:budget.transact(cell,'reserve','blocked',.2)
 except AssertionError:pass
 else:raise AssertionError('Unknown hold must block over-cap call')
 budget.transact(cell,'settle','held',.1)
 budget.transact(cell,'reserve','allowed',.2)
 state=json.loads((cell/'receipts/budget.json').read_text());state['capUsd']=45;(cell/'receipts/budget.json').write_text(json.dumps(state))
 budget.transact(cell,'reserve','large',44.6)
 try:budget.transact(cell,'reserve','over45',.2)
 except AssertionError:pass
 else:raise AssertionError('45 USD hard stop includes unresolved holds')
 network.BASE=p;native=p/'native.json';native.write_text('{"usage":{"output_tokens":0}}')
 at=datetime.datetime.now(datetime.timezone.utc).isoformat();errors=[dict(id=str(i),at=at,model='claude-sonnet-5-5',message='could not be reached',nativeReceipt=str(native),noAnswer=True) for i in range(3)]
 (cell/'receipts/errors.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in errors))
 assert network.paid_streak('claude-sonnet-5-5','')==3
 errors[-1]['returnedEnvelope']=True;(cell/'receipts/errors.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in errors))
 assert network.paid_streak('claude-sonnet-5-5','')==2
 assert retry.CONNECTION.search('OpenAI could not be reached')
print(json.dumps(dict(tests=7,providerCalls=0,hardStopIncludesHolds=True,modelIsolation=True,concurrency=2)))
