"""Attribute observed output limits and apply the predeclared strict scoring rule."""
import copy
import json
from pathlib import Path
import re

BASE=Path(__file__).resolve().parent
CONTESTANTS=['driftbench-verify-uncertainty-cascade','promptfoo']
MODELS=['gemini-3.5-flash-lite']

def limit_reason(receipt, native=None):
    metadata=receipt.get('metadata') or {}
    if native and re.search(r'exceed\w*.*output token|output.token.*(?:maximum|limit)',native.get('result',''),re.I):
        return native['result']
    if metadata.get('finishReason') in ('length','MAX_TOKENS','max_tokens'):
        return metadata['finishReason']
    # Native non-success also sets truncated for turn/budget limits; those are not output-token evidence.
    if receipt['model']!='haiku' and metadata.get('truncated') is True:
        return 'API output truncated'
    return None

def strict_decisions(decisions, affected):
    result=copy.deepcopy(decisions)
    for row in result:
        if row['id'] in affected:
            row.pop('pass',None)
            row['missing']=max(1,row.get('missing',0))
            row['error']='output_limit'
    return result

def rows(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line] if path.exists() else []

def main():
    trace=json.loads((BASE/'evidence/request-attribution.json').read_text())
    index={}
    for row in trace['rows']:
        key=(row['model'],row['phase'],row['fingerprint'])
        index.setdefault(key,{})[(row['contestant'],row['item'],row['order'])]=row
    receipts={r['id']:r for r in rows(BASE/'receipts/calls.jsonl')}
    for error in rows(BASE/'receipts/errors.jsonl'):
        receipts[error['id']]={**receipts.get(error['id'],{}),**error}
    limits=[];unmapped=[];unclassified=[]
    for receipt in receipts.values():
        native=None
        if receipt.get('nativeReceipt'):
            path=Path(receipt['nativeReceipt'])
            if path.exists():
                try:native=json.loads(path.read_text())
                except json.JSONDecodeError:pass
        reason=limit_reason(receipt,native)
        if reason is None:
            if receipt.get('message')=='claude returned an error result' and not native:
                unclassified.append(dict(receipt=receipt['id'],model=receipt['model'],reason='Historical native error body unavailable; output-limit cause is not inferred'))
            continue
        matched=list(index.get((receipt['model'],receipt.get('phase'),receipt.get('fingerprint')),{}).values())
        entry=dict(receipt=receipt['id'],model=receipt['model'],phase=receipt.get('phase'),reason=reason,at=receipt['at'],consumers=matched)
        limits.append(entry)
        if not matched:unmapped.append(entry)
    counts={}
    for model in MODELS:
        counts[model]={}
        for contestant in CONTESTANTS:
            count={}
            for scope in ['all','test']:
                hits=[r for r in limits if r['model']==model and (scope=='all' or r['phase']=='test') and any(c['contestant']==contestant for c in r['consumers'])]
                affected=sorted({(r['phase'],c['item']) for r in hits for c in r['consumers'] if c['contestant']==contestant})
                count[scope]=dict(answerEnvelopes=len(hits),affectedItems=len(affected),items=[dict(phase=p,id=i) for p,i in affected])
            counts[model][contestant]=count
    output=dict(counts=counts,limits=limits,unmappedLimits=unmapped,unclassifiedHistoricalNativeErrors=unclassified,
        rule='Strict is primary; any confirmed output limit makes every consuming contestant/item an error. Product-final preserves the original verdict, including fallback.',
        source='evidence/scoring-freeze.json; evidence/request-attribution.json; receipts/calls.jsonl; receipts/errors.jsonl; receipts/native/*.json')
    (BASE/'evidence/output-limit-errors.json').write_text(json.dumps(output,indent=2)+'\n')
    for model in MODELS:
        for phase in ['pilot','validity','noise-0','noise-1','noise-2','results']:
            path=BASE/phase/f'{model}.json'
            if not path.exists():continue
            original=json.loads(path.read_text());strict=copy.deepcopy(original)
            for contestant in strict['contestants']:
                affected={x['id'] for x in counts[model][contestant['contestant']]['all']['items'] if x['phase']==('test' if phase=='results' else phase)}
                contestant['decisions']=strict_decisions(contestant['decisions'],affected)
                # Summary is an original product field; scored comparisons recompute from decisions only.
                contestant.pop('summary',None)
            strict['scoreVariant']='strict';strict['productFinalSource']=path.name
            (BASE/phase/f'{model}.strict.json').write_text(json.dumps(strict,indent=2)+'\n')
    print(json.dumps({'confirmedLimitEnvelopes':len(limits),'unmapped':len(unmapped),'unclassifiedHistoricalErrors':len(unclassified)}))
    return output

if __name__=='__main__':main()
