"""Seal the complete remaining TEST population without consulting labels or outcomes."""
import collections,datetime,hashlib,json,pathlib,subprocess,tempfile
R=pathlib.Path(__file__).resolve().parent;D=R/'data'
SEED='astra-mm-test-20261013-v1'
sha=lambda b:hashlib.sha256(b if isinstance(b,bytes) else b.encode()).hexdigest()
def dump(p,x):p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
sample950=json.loads((D/'sample950-source.json').read_text());protected={str(x['id']) for x in sample950['items']}
ledger=json.loads((D/'ledger-pool-ids.json').read_text());sealed={str(x['id']) for x in ledger['items']}
exposed=set(json.loads((D/'ledger-excluded-ids.json').read_text()))
assert len(protected)==950 and len(sealed)==600 and not protected&sealed and protected<=exposed
excluded=exposed|sealed
pages=json.loads((D/'ledger-exposure-audit.json').read_text())['pages']
cache=pathlib.Path(tempfile.gettempdir())/'driftbench-judge-benchmarks'
selected=[];groups=['reasoning','chat','linguistics','language mixing','safety']
for page in pages:
 body=(cache/sha(page['url'])[:16]).read_bytes();assert sha(body)==page['sha256']
 for val in json.loads(body)['rows']:
  id=str(val['row_idx'])
  if id in excluded or bytes.fromhex(sha('split:mmeval:'+id))[0]<77:continue
  r=val['row']
  if r['subset'] not in groups:continue
  first=bytes.fromhex(sha('mmeval:'+id))[0]%2==0
  selected.append({'id':id,'group':r['subset'],'language':r['language'],'question':r['prompt'],'a':r['chosen'] if first else r['rejected'],'b':r['rejected'] if first else r['chosen'],'label':'A' if first else 'B'})
assert len(selected)==len({r['id'] for r in selected})==1212
# A census gives every subset its exact population proportion. Seeded ranks randomize order within each subset.
strata={g:sorted([r for r in selected if r['group']==g],key=lambda r:sha(SEED+':'+r['id'])) for g in groups}
# Interleave proportional strata, so partial operational checkpoints are not single-subset blocks.
ordered=sorted([(i+.5)/len(rs),g,i,r] for g,rs in strata.items() for i,r in enumerate(rs))
selected=[r for _,_,_,r in ordered]
dump(D/'test.json',selected)
dump(D/'test-excluded-ids.json',sorted(excluded,key=int))
frozen=json.loads((R/'frozen.json').read_text())
seal={'sealedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'label':'All remaining never-scored eligible TEST, disjoint confirmation census','count':len(selected),'seed':SEED,'sampling':'Census of eligible TEST. Exact proportional subset allocation, seeded within-subset ordering, proportionally interleaved dispatch. No labels or outcomes used in selection.','subsetCounts':{g:len(rs) for g,rs in strata.items()},'protected950Count':950,'otherLane600Count':600,'priorExposureExcludedCount':len(exposed),'eligibleBeforeOtherLane':1812,'ledgerBranchCommit':subprocess.check_output(['git','rev-parse','research/ledger-mm']).decode().strip(),'sourceSealHash':sha((D/'ledgerSeal-source.json').read_bytes()),'ledgerPoolHash':ledger['sourceHash'],'sample950Hash':sha((D/'sample950-source.json').read_bytes()),'testSha256':sha((D/'test.json').read_bytes()),'excludedIdsSha256':sha((D/'test-excluded-ids.json').read_bytes()),'frozenConfigSha256':sha((R/'frozen.json').read_bytes()),'candidate':frozen['rule'],'base':frozen['base'],'openai':{'model':'gpt-6-luna','reasoning_effort':'low','pricePerMillionInputUsd':.10,'pricePerMillionOutputUsd':.50},'gemini':{'model':'gemini-3.8-flash','thinkingLevel':'low','timeoutSeconds':180,'retries':1,'maxConcurrent':2,'keyFile':'~/.nexus-secrets/gemini-driftbench.key'},'maxConcurrentAllProviders':6,'metric':frozen['metric'],'interval':frozen['interval'],'noTuning':True,'testPasses':1,'ids':[{'id':r['id'],'group':r['group'],'language':r['language']} for r in selected]}
dump(R/'test-seal.json',seal)
print(json.dumps({k:v for k,v in seal.items() if k!='ids'},indent=2))
