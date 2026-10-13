"""Join new model evidence into the verify dossier without calling or rescoring a model."""
import collections,datetime,hashlib,json,subprocess,sys
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[1]
DOSSIER=Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/codex/dossier-ledger-verify.md')
MODELS={'claude-sonnet-5-5':'sonnet','gpt-6.1-sol':'sol61'}
CONTESTANTS=['driftbench-verify-uncertainty-cascade','promptfoo']
def read(p):return json.loads(p.read_text())
def rows(p):return [json.loads(x) for x in p.read_text().splitlines() if x.strip()] if p.exists() else []
def main():
 original=read(BASE/'evidence/cells.json')
 assert read(BASE/'evidence/finalizer-state.json')['status']=='offline evidence ready for review'
 text=(BASE/'REPORT.md').read_text();marker='## Execution recovery and validity disclosure'
 supplement='\n'+marker+text.split(marker,1)[1] if marker in text else ''
 supplement=supplement.split('\n## Additional Sonnet and Sol cells',1)[0]
 sections=['\n## Additional Sonnet and Sol cells\n',
 '- Separate model cells use the same sealed 221 items, unchanged audit map, frozen contestants, 20-item pilot, 48 mutations and 30-by-3 noise checks.',
 '- Sol has a 25 USD cap. Sonnet has an owner-authorized 45 USD cap only if its five cache-disabled DEV calls project at most 45 USD, including calibration fees and holds.',
 '- Sonnet preserves its first five cached answers and their 57.413792 USD projection. Five next unanswered DEV requests remeasure cost with DISABLE_PROMPT_CACHING=1 for both contestants.',
 '- Both contestants use medium reasoning. Sonnet uses alias sonnet in the lean empty-directory CLI route; Sol uses the Responses API without temperature.',
 '- Sonnet caps total output including thinking at 16384 tokens. Sol caps total output including reasoning at 32768 tokens. Output-limit items remain errors under the strict headline.',
 '- Sol Standard published prices per million tokens: input 2 USD, cached input 0.10 USD, cache write 2.50 USD, output 10 USD. Source: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), read 13 October 2026.',
 '- Sonnet costs come from native total_cost_usd. Sol costs come from recorded usage and its published price. Raw usage envelopes are retained.',
 '- Every returned answer remains cached. Transport failures keep uncertain-charge holds. No model or setting is tuned on sealed data.',
 '- These additional cells remain outside the original 18-cell multiplicity family until the collator declares the combined adjustment.\n',
 '| Model | Status | Five-call cost USD | Projected 379-unit cost USD | Settled USD | Unknown holds USD | Evidence folder |',
 '|---|---|---|---|---|---|---|']
 evidence=[];projection_sections=[];original.setdefault('newModelFees',{})
 for model,folder in MODELS.items():
  base=BASE/folder;progress=read(base/f'{model}.progress.json');gate=read(base/'evidence/cost-sample.json') if (base/'evidence/cost-sample.json').exists() else None
  remeasure=read(base/'evidence/cache-off-cost-sample.json') if (base/'evidence/cache-off-cost-sample.json').exists() else None
  if remeasure:gate=remeasure
  cap=read(base/'evidence/runtime-freeze.json')['capUsd']
  final=read(base/'evidence/finalizer-state.json') if (base/'evidence/finalizer-state.json').exists() else None
  budget=read(base/'receipts/budget.json') if (base/'receipts/budget.json').exists() and (base/'receipts/budget.json').stat().st_size else {'spentUsd':0,'reservations':{}}
  settled=budget['spentUsd'];held=sum(r['usd'] for r in budget['reservations'].values());assert settled+held<=cap+1e-8
  status=final['status'] if final else progress['status']
  sections.append(f"| {model} | {status} | {gate['costUsd']:.8f} | {gate['projected379UnitsUsd']:.8f} | {settled:.8f} | {held:.8f} | {folder}/ |" if gate else f'| {model} | {status} | pending | pending | {settled:.8f} | {held:.8f} | {folder}/ |')
  original['newModelFees'][model]=dict(settledUsd=settled,unresolvedMaximumUsd=held,maximumAccountedUsd=settled+held,capUsd=cap)
  for name in ['model-amendment.json','runtime-freeze.json','reporting-freeze.json','cost-sample.json','pilot-projection.json','cache-off-amendment.json','cache-off-cost-selection.json','cache-off-cost-sample.json','cap45-activation.json']:
   p=base/'evidence'/name
   if p.exists():original['freeze']['hashes'][f'{folder}/evidence/{name}']=hashlib.sha256(p.read_bytes()).hexdigest()
  if gate:
   projection_sections+=['',f"{model} cost projection breakdown:",'','| Contestant | Stage | Reference requests | Measured unit USD | Projected USD |','|---|---|---|---|---|']
   for r in gate['components']:projection_sections.append(f"| {r['contestant']} | {r['order']} | {r['referenceRequests']} | {r['unitCostUsd']:.8f} | {r['referenceRequests']*r['unitCostUsd']:.8f} |")
   measured=collections.Counter()
   for r in gate['outcomes']:measured[r['labels']['contestant']]+=r['costUsd']
   projection_sections.append(f"\nFive-call measured cost by contestant: cascade {measured[CONTESTANTS[0]]:.8f} USD; promptfoo {measured['promptfoo']:.8f} USD.")
   if remeasure:projection_sections.append(f"Additional conservative allowance: all calibration fees {gate['priorAndCalibrationSettledUsd']:.8f} USD plus holds {gate['holdsUsd']:.8f} USD. Cache writes observed in the five new calls: {gate['cacheCreationTokens']} tokens.")
   projection_sections.append('Projection uses the original full Luna request counts, with the highest sampled cascade fee assigned to unsampled stages. It is an estimate, not a measured full-cell cost.\n')
  if not final:continue
  assert final['status']=='offline evidence ready for review' and final['complete']
  for path,h in read(base/'evidence/reporting-freeze.json')['sourceHashes'].items():assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest()==h,path
  extra=read(base/'evidence/cells.json');assert len(extra['cells'])==1
  original['cells']=[c for c in original['cells'] if c['model']!=model]+extra['cells']
  original['noiseFloor'].update(extra['noiseFloor']);original['outputLimitErrors']['counts'].update(extra['outputLimitErrors']['counts'])
  for key in ['limits','unmappedLimits','unclassifiedHistoricalNativeErrors']:
   original['outputLimitErrors'][key]=[x for x in original['outputLimitErrors'][key] if x.get('model')!=model]+extra['outputLimitErrors'][key]
  cell=extra['cells'][0];mapping=collections.defaultdict(set)
  for r in read(base/'evidence/request-attribution.json')['rows']:mapping[(r['phase'],r['fingerprint'])].add(r['contestant'])
  calls=rows(base/'receipts/calls.jsonl');sample=read(BASE/'evidence/new-model-cost-sample.json')['requests']
  for r,s in zip(calls[:5],sample):mapping[(r['phase'],r['fingerprint'])].add(s['labels']['contestant'])
  costs=collections.Counter();tokens=collections.Counter();unassigned=0
  for r in calls:
   owners=mapping[(r['phase'],r['fingerprint'])]
   if len(owners)!=1:unassigned+=r['costUsd'];continue
   c=next(iter(owners));costs[c]+=r['costUsd']
   metadata=r.get('metadata') or {};usage=metadata.get('usage') or metadata.get('nativeUsage') or {}
   tokens[(c,'input')]+=usage.get('input_tokens',0);tokens[(c,'output')]+=usage.get('output_tokens',0)
   tokens[(c,'reasoning')]+=(usage.get('output_tokens_details') or {}).get('reasoning_tokens',0)
  evidence.append(dict(model=model,folder=folder,cell=cell,costs=dict(costs),unassignedUsd=unassigned,tokens=[dict(contestant=c,input=tokens[(c,'input')],output=tokens[(c,'output')],reasoning=tokens[(c,'reasoning')]) for c in CONTESTANTS]))
 original['newModelCostAttribution']=[{k:v for k,v in x.items() if k!='cell'} for x in evidence]
 original['at']=datetime.datetime.now(datetime.timezone.utc).isoformat();(BASE/'evidence/cells.json').write_text(json.dumps(original,indent=2)+'\n')
 sections+=projection_sections
 sections+=['','| Model | Contestant | Constant-fail official / audited | TEST unique-key cost USD | All-phase attributed settled USD | TEST strict missing / product-final missing | TEST output-limit answers |','|---|---|---|---|---|---|---|']
 for entry in evidence:
  cell=entry['cell'];ch=original['cheaters'];baseline=f"{round(ch['alwaysFailOfficial']*221)}/221 / {round(ch['alwaysFailAudited']*221)}/221"
  for i,c in enumerate(CONTESTANTS):
   strict=read(BASE/entry['folder']/f"results/{entry['model']}.strict.json")['contestants'][i]['decisions'];product=read(BASE/entry['folder']/f"results/{entry['model']}.json")['contestants'][i]['decisions']
   missing=lambda ds:sum(d.get('missing',0)>0 or type(d.get('pass')) is not bool for d in ds)
   cost=cell['costPer100UniqueKeys'][c]*221/100;limits=cell['outputLimitErrors'][c]['test']['answerEnvelopes']
   sections.append(f"| {entry['model']} | {c} | {baseline} | {cost:.8f} | {entry['costs'].get(c,0):.8f} | {missing(strict)} / {missing(product)} | {limits} |")
  sections.append(f"\n{entry['model']}: unattributed settled cost {entry['unassignedUsd']:.8f} USD. Exact tokens and receipt attribution: evidence/cells.json newModelCostAttribution.\n")
 sections+=['','Sources per model folder: evidence/model-amendment.json, evidence/cost-sample.json, evidence/cells.json, evidence/output-limit-errors.json and receipts/native/.','Scores, paired exact p values and strict/product-final endpoints appear in the tables above for every completed cell. Pending cells have no sealed TEST score.','']
 subprocess.run([sys.executable,str(BASE/'render_report.py'),str(DOSSIER)],cwd=ROOT,check=True)
 result=(BASE/'REPORT.md').read_text()+supplement+'\n'.join(sections)
 result=result.replace('Holm correction belongs to the prespecified 18-cell family and remains pending at this handoff. No local WIN or overall superiority claim is made.','The original three models belong to the prespecified 18-cell family. Flash Lite, Sonnet and Sol are additional cells. Multiplicity adjustment remains pending with the collator. No overall superiority claim is made.')
 assert '\u2014' not in result and '\u2013' not in result
 for p in [BASE/'REPORT.md',DOSSIER]:p.write_text(result)
 print(json.dumps(dict(completedNewModels=[e['model'] for e in evidence],newModelFees=original['newModelFees'],providerCalls=0)))
if __name__=='__main__':main()
