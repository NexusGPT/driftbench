"""Describe the optional replication's native maps before deriving its hidden seed."""
import json
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
families={
 'promptfoo-rubric':['conjunction','negation','scope','period','arithmetic','partial-completion','quoted-claim','disjunction','cross-language','later-contradiction','long-fluent','tag-injection'],
 'langfuse-reference':['near-number','units','negation','entity-binding','conditions','quantifiers','revision','multilingual','fluent-extra','omission','long-distractors','instruction-data'],
}
source='Original construction families: '+', '.join(sorted({x for f in families.values() for x in f}))+'.\n'
source+='Truth is pass or fail, planted by paired code construction. The workflow stages are evaluate and done.\n'
source+='Numeric settings: reply_length is a target of 12 to 260 words; number_size is 101 to 991 credits; distractor_count is 0 to 24 archived records.\n'
source+='The native budget selects family and truth cells with numeric runtime settings. Code renders the actual judge fixture from those selections.\n'
(HERE/'source.txt').write_text(source)
evidence={'source':'source.txt','quote':source.splitlines()[0]}
common={'produced_by':'code','approved':True}
def dimension(id,kind,role,values):
 return {'id':id,'title':id,'kind':kind,'role':role,**common,'values':[{'id':v,'title':v,'evidence':evidence,'produced_by':'code'} for v in values]}
for name, fs in families.items():
 proposal={'version':1,'agent':'astra-fixtures','produced_by':{'family':'code','model':'deterministic construction','at':'2026-10-13T03:44:00.000Z'},'sources':[{'kind':'prompt','path':'source.txt'}],
 'dimensions':[dimension('flow','behaviour','axis',fs),dimension('truth','persona','axis',['pass','fail']),dimension('stage','stage','detail',['evaluate','done']),dimension('stage_transition','behaviour','detail',['evaluate-to-done'])],
 'constraints':[], 'phrases':[{'dimension':'flow','value':f,'text':'Evaluate the supplied fictional reply.','lang':'en',**common} for f in fs]+[{'dimension':'stage_transition','value':'evaluate-to-done','text':'Evaluate the supplied fictional reply.','lang':'en',**common}],
 'relations':[{'kind':'path','id':f+'-path','flow':f,'when':{'truth':['pass','fail']},'stages':['evaluate','done'],'end_state':{'source':'tool:verdict.record','mode':'subset','expect':{'outcome':'{verdict}'}},'evidence':evidence,**common} for f in fs]+[{'kind':'binds','subject':{'dimension':'truth','value':v},'slots':{'verdict':v},'evidence':evidence,**common} for v in ['pass','fail']],
 'numeric_settings':[{'id':id,'min':lo,'max':hi,'integer':True,'unit':unit,'evidence':{'source':'source.txt','quote':source.splitlines()[2]},**common} for id,lo,hi,unit in [('reply_length',12,260,'words'),('number_size',101,991,'credits'),('distractor_count',0,24,'records')]]}
 (HERE/(name+'-map.json')).write_text(json.dumps(proposal,indent=2)+'\n')
print('Two native map proposals written. Seed not selected yet.')
