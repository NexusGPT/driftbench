"""Symmetric, read-only audit of closed results using the new native-stop detector."""
import copy,datetime,hashlib,importlib.util,json
from pathlib import Path
BASE=Path(__file__).resolve().parent
def read(p):return json.loads(p.read_text())
def rows(p):return [json.loads(x) for x in p.read_text().splitlines() if x.strip()] if p.exists() else []
def module(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
def main():
 detector=module('native_limit_detector',BASE/'sonnet/output_limits.py');stats=module('frozen_stats',BASE/'stats.py')
 pool=read(BASE/'evidence/pool.json');audit=read(BASE/'evidence/audit-map.json');results=[];hashes={}
 for model,folder in [('haiku',''),('gpt-6-luna',''),('gemini-3.5-flash-lite','lite')]:
  b=BASE/folder;trace=read(b/'evidence/request-attribution.json')['rows'];index={}
  for r in trace:
   if r['model']==model:index.setdefault(r['fingerprint'],{})[(r['phase'],r['contestant'],r['item'],r['order'])]=r
  receipts={r['id']:r for r in rows(b/'receipts/calls.jsonl') if r['model']==model}
  for e in rows(b/'receipts/errors.jsonl'):
   if e['model']==model:receipts[e['id']]={**receipts.get(e['id'],{}),**e}
  previous=read(b/'evidence/output-limit-errors.json');before={r['receipt'] for r in previous['limits'] if r['model']==model}
  confirmed=[];native_count=0;metadata_count=0;unknown=[]
  for r in receipts.values():
   p=Path(r['nativeReceipt']) if r.get('nativeReceipt') else b/'receipts/native'/f"{r['id']}.json"
   native=None
   if p.exists() and p.stat().st_size:
    try:native=read(p);native_count+=1
    except json.JSONDecodeError:unknown.append(dict(receipt=r['id'],reason='Unparseable native body'))
   if (r.get('metadata') or {}).get('finishReason') is not None:metadata_count+=1
   reason=detector.limit_reason(r,native)
   if reason:
    consumers=list(index.get(r.get('fingerprint'),{}).values())
    if r.get('phase'):consumers=[c for c in consumers if c['phase']==r['phase']]
    assert consumers,(model,r['id'],'unmapped output limit')
    confirmed.append(dict(receipt=r['id'],reason=reason,new=r['id'] not in before,consumers=consumers,nativePath=str(p.relative_to(BASE)) if native else None))
   elif not native and r.get('message')=='claude returned an error result':unknown.append(dict(receipt=r['id'],reason='Historical native error body unavailable'))
  assert before<={r['receipt'] for r in confirmed}, 'New detector must preserve prior confirmed limits'
  product_path=b/f'results/{model}.json';strict_path=b/f'results/{model}.strict.json'
  for path in [product_path,strict_path,b/'evidence/output-limit-errors.json']:
   hashes[str(path.relative_to(BASE))]=hashlib.sha256(path.read_bytes()).hexdigest()
  strict=read(strict_path);updated=copy.deepcopy(strict);counts={}
  for c in updated['contestants']:
   name=c['contestant'];counts[name]={}
   for scope in ['all','test']:
    hits=[r for r in confirmed if any(x['contestant']==name and (scope=='all' or x['phase']=='test') for x in r['consumers'])]
    affected={(x['phase'],x['item']) for r in hits for x in r['consumers'] if x['contestant']==name and (scope=='all' or x['phase']=='test')}
    counts[name][scope]=dict(answerEnvelopes=len(hits),affectedItems=len(affected),newEnvelopes=sum(r['new'] for r in hits))
   affected={x['item'] for r in confirmed for x in r['consumers'] if x['contestant']==name and x['phase']=='test'}
   c['decisions']=detector.strict_decisions(c['decisions'],affected)
  a,b_decisions=[c['decisions'] for c in strict['contestants']];x,y=[c['decisions'] for c in updated['contestants']]
  delta={label:dict(official=stats.compare(pool,a,b_decisions,labels),auditCorrection=stats.compare(pool,x,y,labels)) for label,labels in [('officialLabels',{}),('auditedLabels',audit)]}
  results.append(dict(model=model,receiptCount=len(receipts),nativeBodiesRead=native_count,finishMetadataRead=metadata_count,unknownNativeErrors=unknown,counts=counts,newLimits=[r for r in confirmed if r['new']],scores=delta,productFinalChanged=False))
 out=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),authorization='Owner accepts labelled strict audit correction; closed files stay unchanged; same detector audits both contestants on Haiku, Luna and Flash Lite.',detectorSource='sonnet/output_limits.py',detectorSha256=hashlib.sha256((BASE/'sonnet/output_limits.py').read_bytes()).hexdigest(),closedFileHashes=hashes,cells=results,providerCalls=0)
 for path,h in hashes.items():assert hashlib.sha256((BASE/path).read_bytes()).hexdigest()==h,path
 (BASE/'evidence/closed-output-limit-audit.json').write_text(json.dumps(out,indent=2)+'\n')
 print(json.dumps([dict(model=r['model'],newLimits=len(r['newLimits']),officialCorrect=r['scores']['officialLabels']['official']['correct'],corrected=r['scores']['officialLabels']['auditCorrection']['correct'],auditedCorrected=r['scores']['auditedLabels']['auditCorrection']['correct'],counts=r['counts'],unknown=len(r['unknownNativeErrors'])) for r in results]))
if __name__=='__main__':main()
