"""Permit one requested model cell at a time; Gemini 3.8 has no automatic restart path."""
import datetime,json,time
from pathlib import Path
BASE=Path(__file__).resolve().parent;CONTROL=BASE/'evidence/network-control.json'
def read(p):
 try:return json.loads(p.read_text())
 except (FileNotFoundError,json.JSONDecodeError):return {}
def set_model(model,stop=False):
 value=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),model=model,stop=stop,policy='ten healthy probes spaced 30 seconds, concurrency two, one model cell at a time')
 p=CONTROL.with_suffix('.tmp');p.write_text(json.dumps(value,indent=2)+'\n');p.replace(CONTROL);print(json.dumps(value),flush=True)
def ready(folder,model):
 p=read(BASE/folder/f'{model}.progress.json');f=read(BASE/folder/'evidence/finalizer-state.json')
 return f.get('status')=='offline evidence ready for review' or p.get('status','').startswith('paused: cost projection') or p.get('status')=='owner budget decision'
while not (read(BASE/'evidence/haiku-test-timeout-recovery.json').get('status')=='complete' and read(BASE/'evidence/finalizer-state.json').get('status')=='offline evidence ready for review'):time.sleep(5)
while read(BASE/'luna-addendum/state.json').get('status')!='complete':time.sleep(5)
set_model('claude-sonnet-5-5')
while not ready('sonnet','claude-sonnet-5-5'):time.sleep(5)
set_model('gpt-6.1-sol')
while not ready('sol61','gpt-6.1-sol'):time.sleep(5)
set_model('gpt-6.1-sol',True)
