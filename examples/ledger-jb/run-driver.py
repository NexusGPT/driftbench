#!/usr/bin/env python3
"""Resume sealed phases, then each ready model's full test pass. No content retries."""
from pathlib import Path
import subprocess,json,datetime,os
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parent.parent
R=ROOT/'results'
BASE=['node','--import','tsx',str(ROOT/'src/run.mjs'),'--execute','--core-dossier','/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/codex/dossier-ledger-core.md','--spend-ledger','/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/spend-ledger.md']
def stamp(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def event(value):
    row={'at':stamp(),**value}
    print(json.dumps(row),flush=True)
    (R/'driver-state.json').write_text(json.dumps(row,indent=2)+'\n')
event({'status':'running','pid':os.getpid(),'core':'35f07309','concurrency':{'gpt-6-luna':4,'claude-haiku-5-5':4,'gemini-3.8-flash':2}})
blocked=[]
for model in ['gpt-6-luna','claude-haiku-5-5','gemini-3.8-flash']:
    for phase in ['pilot','fixtures','noise','validity','test']:
        if phase=='test':
            ready=json.loads((R/f'readiness-{model}.json').read_text())
            if not all(ready[k] for k in ['pilotComplete','fixturesComplete','noiseComplete','validityPassed']):
                blocked.append({'model':model,'reason':'registered preparation gate failed'})
                event({'status':'model-blocked','model':model,'readiness':ready})
                break
        event({'status':'phase-running','model':model,'phase':phase,'pid':os.getpid(),'maxConcurrentCalls':2 if model=='gemini-3.8-flash' else 4})
        with (R/f'run-{phase}-{model}.log').open('a') as log:
            result=subprocess.run(BASE+['--model',model,'--phase',phase],cwd=REPO,stdout=log,stderr=subprocess.STDOUT)
        with (R/'report-build.log').open('a') as log:
            subprocess.run(['node',str(ROOT/'src/report.mjs')],cwd=REPO,stdout=log,stderr=subprocess.STDOUT,check=True)
            subprocess.run(['node',str(ROOT/'summarize-reasks.mjs')],cwd=REPO,stdout=log,stderr=subprocess.STDOUT,check=True)
        event({'status':'phase-finished','model':model,'phase':phase,'exit':result.returncode,'pid':os.getpid()})
        if result.returncode:
            event({'status':'stopped-on-error','model':model,'phase':phase,'exit':result.returncode,'log':str(R/f'run-{phase}-{model}.log')})
            raise SystemExit(result.returncode)
event({'status':'finished','blocked':blocked,'pid':os.getpid()})
