"""Render planted fixtures from native budget rows without a model or judge output."""
import argparse,ast,copy,hashlib,json,random,re,sys
from pathlib import Path
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[2]

def main():
 cli=argparse.ArgumentParser();cli.add_argument('--seed',type=int,required=True);args=cli.parse_args()
 pfsource=(ROOT/'comparisons/promptfoo/hard/generate.py').read_text()
 old='price = 31 + pair if seed == TRAIN_SEED else rng.randint(101, 991)'
 assert old in pfsource
 pf={ '__name__':'map_construction','__file__':str(ROOT/'comparisons/promptfoo/hard/generate.py'),'numeric_price':0 }
 exec(compile(pfsource.replace(old,'price = numeric_price'),'<original rubric family constructor>','exec'),pf)
 tree=ast.parse((ROOT/'comparisons/langfuse/hard/generate.py').read_text())
 original_loop=next(n for n in tree.body if isinstance(n,ast.For))
 notes={}
 for name in ['promptfoo-rubric','langfuse-reference']:
  report=json.loads((HERE/name/'generate-report.json').read_text())
  assert report['budget']['picked']==192 and report['budget']['pairs']['share']==1
  out=[]
  for i,pick in enumerate(report['budget']['numeric']['rows']):
   family=pick['cell']['flow'];good=pick['cell']['truth']=='pass';v=pick['vars']
   if name=='promptfoo-rubric':
    pf['numeric_price']=v['number_size']
    generated=pf['make_sets'](20270000+args.seed%10000+i,24)['rubric']
    item=copy.deepcopy(next(r for r in generated if r['kind']==family and r['truth']==good))
    item['reply']=item['reply'].replace('The archive contains many superseded offers, none of which changes the final recommendation. '*24,'')
    output_key='reply'
   else:
    n=max(0,(v['number_size']-47)//13)
    loop=copy.deepcopy(original_loop);loop.iter=ast.List(elts=[ast.Constant(n)],ctx=ast.Load())
    env={'rows':[],'prefix':'map-'}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[loop],type_ignores=[])),'<original reference family constructor>','exec'),env)
    item=copy.deepcopy(next(r for r in env['rows'] if r['family']==family and r['label']==('pass' if good else 'fail')))
    serial=100000+args.seed%100000+i
    for k in ['query','reference','output']:
     item[k]=re.sub(r'Vela-\d+',f'Aster-{serial}',item[k]);item[k]=re.sub(r'Luma-\d+',f'Borel-{serial}',item[k])
    if family=='long-distractors':item['reference']=item['reference'].split('\nArchive (not facts about this plan):')[0]
    output_key='output'
   rng=random.Random(args.seed+i+(0 if name=='promptfoo-rubric' else 20000))
   padding=['Thank you for reading.','Please review the stated details carefully.','Consider the information requested in the question.','The requested summary follows the terms supplied here.']
   # The last sentence describes the answer's form, not a new product fact.
   # Use only the three nonassertive phrases for the strict reference row.
   if name=='langfuse-reference':padding=padding[:3]
   while len(item[output_key].split()) < v['reply_length']:
    item[output_key]+=' '+rng.choice(padding)
   distractors=[]
   for j in range(v['distractor_count']):
    tag=f'Zori-{rng.randrange(1000,9999)}'
    distractors.append(f'Unrelated archived offer {tag} lists a provisional price of {rng.randrange(101,991)} credits; it is not the requested offer.')
   if distractors:
    archive='\nBackground archive, not requested facts or additional rubric requirements:\n'+'\n'.join(distractors)
    item['rubric' if name=='promptfoo-rubric' else 'reference']+=archive
   item['id']=f'map-{name}-{i+1:03}'
   item['construction']={'native_spec':pick['spec'],'family':family,'vars':v,'quantiles':pick['quantiles'],'actual_reply_words':len(item[output_key].split())}
   out.append(item)
  random.Random(args.seed+len(name)).shuffle(out)
  (HERE/f'{name}-raw.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
  notes[name]={'raw_cases':len(out),'native_budget':report['budget'],'complete_specs':report['summary']['complete']}
 (HERE/'construction.json').write_text(json.dumps({'seed':args.seed,'rows':notes},indent=2)+'\n')
 print('Rendered 192 fictional planted cases per row from native budget selections.')
if __name__=='__main__':main()
