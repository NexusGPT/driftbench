"""Read-only census of earlier recorded model cells for zero-token CLI errors."""
import collections
from common import *

def envelope_matches(value):
    if isinstance(value,list):return sum(envelope_matches(v) for v in value)
    if not isinstance(value,dict):return 0
    usage=value.get('usage') or {}
    hit=value.get('terminal_reason')=='api_error' and not any(usage.get(k,0) for k in ('input_tokens','output_tokens','cache_creation_input_tokens','cache_read_input_tokens'))
    return int(hit)+sum(envelope_matches(v) for v in value.values())

paths=['calls.jsonl','dialect/calls.jsonl','flash-lite/primary/calls.jsonl','flash-lite/dialect/calls.jsonl']
models={'haiku','claude-haiku-5-5','gpt-6-luna','gemini-3.5-flash-lite'}
result={'created':stamp(),'rule':'terminal_reason=api_error and zero input/output/cache tokens in a nested provider envelope','sources':{},'by_model':{},'affected':[]}
for name in paths:
    path=HERE/name;rows=[json.loads(s) for s in path.read_text().splitlines()]
    result['sources'][name]={'sha256':digest(path),'records':len(rows)}
    for row in rows:
        if row['model'] not in models:continue
        model=row['model'];counts=result['by_model'].setdefault(model,{'records':0,'matching_records':0,'counted_as_usable_answer':0})
        counts['records']+=1
        if envelope_matches(row):
            counts['matching_records']+=1;counts['counted_as_usable_answer']+=int(row.get('success',False))
            result['affected'].append({'source':name,'model':model,'request_sha256':row['request_sha256'],'success':row.get('success'),'outcome':row.get('outcome')})
result['matching_record_count']=len(result['affected'])
result['earlier_journals_modified']=False
dump(HERE/'api-error-envelope-audit.json',result)
print(json.dumps(result,indent=2))
