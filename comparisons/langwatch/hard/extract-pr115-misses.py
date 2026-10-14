"""Read all completed PR115 criterion misses without changing any measured procedure."""
import json,pathlib
HERE=pathlib.Path(__file__).parent
calls={c.get('request_sha256',c.get('key')):c for c in map(json.loads,(HERE/'recorded/calls.jsonl').read_text().splitlines())}
misses=[];counts={}
for tag,fixture in [('', 'judges-v4.json'),('-heldout','judges-heldout-v4.json')]:
 record=json.loads((HERE/'recorded'/f'judges-pr115{tag}.json').read_text());assert record['complete']
 assert record['sourceCommit']=='8195902dd20c84267f85feba268c17868e00dfbe'
 cases={c['id']:c for c in json.loads((HERE/fixture).read_text())}
 for answer in record['answers']:
  case=cases[answer['id']]
  for index,(truth,prediction) in enumerate(zip(case['truth'],answer['predictions'])):
   if truth==prediction:continue
   ref=answer['request_sha256s'][index];call=calls[ref]
   misses.append({'cohort':'fresh'if tag else'hard','case':case,'criterionIndex':index,'truth':truth,'prediction':prediction,'details':answer['details'][index],'request_sha256':ref,'response':call['text'],'system':call['system'],'user':call['user'],'measuredAt':call.get('measuredAt')})
 counts['fresh'if tag else'hard']={'primaryCorrect':sum(a['predictions'][0]==cases[a['id']]['truth'][0] for a in record['answers']),'vectorCorrect':sum(a['predictions']==cases[a['id']]['truth'] for a in record['answers']),'n':len(cases)}
result={'sourceCommit':'8195902dd20c84267f85feba268c17868e00dfbe','counts':counts,'misses':misses,'noModelCalls':True,'noProcedureChanges':True}
(HERE/'recorded/pr115-misses.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'counts':counts,'misses':len(misses)},indent=2))
for m in misses:
 print('\n',m['cohort'],m['case']['id'],m['criterionIndex'],'truth',m['truth'],'prediction',m['prediction'])
 print('CRITERION:',m['case']['criteria'][m['criterionIndex']]);print('SCENARIO:',m['case']['scenario']);print('OBSERVED:',m['case']['transcript']);print('PARSED:',json.dumps(m['details']));print('RAW:',m['response'])
