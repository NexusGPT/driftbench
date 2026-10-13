"""Publish complete hard/fresh cohorts, never select candidates on held-out scores."""
import argparse,hashlib,json,pathlib,datetime,re,subprocess,zoneinfo
HERE=pathlib.Path(__file__).parent;ROOT=HERE.parents[2]
PR115_SOURCE='8195902dd20c84267f85feba268c17868e00dfbe'
OLD_CRITERION_LIMIT='Defective mixed-role adapter: serialized user/context/tool text is collapsed into an agent entry. These retained criterion counts are not reliable pure-quality comparisons.'
CRITERION_VARIANTS=['ours','audit','theirs','compliance','pr115']
def require_metric(rows,key,total=None,allow_partial=False):
 if key not in rows:raise ValueError('Missing study metric '+key)
 value=rows[key]
 partial=allow_partial and key.startswith('longtrace-v2-pr115-')
 if allow_partial and not partial:raise ValueError('Checkpoint exception is limited to long v2 PR 115')
 if (not value.get('complete') or value.get('pending',0)) and not partial:raise ValueError('Incomplete '+key)
 if total is not None and value['total']!=total:raise ValueError('Wrong cohort size '+key)
 if value['n']+value.get('unscored',0)!=value['total'] or not 0<=value['correct']<=value['n']:raise ValueError('Inconsistent score counts '+key)
 if all(field in value for field in ['correct_ids','wrong_ids','unscored_ids']):
  identifiers=value['correct_ids']+value['wrong_ids']+value['unscored_ids']
  if len(identifiers)!=value['total'] or len(set(identifiers))!=value['total'] or len(value['correct_ids'])!=value['correct'] or len(value['wrong_ids'])!=value['n']-value['correct'] or len(value['unscored_ids'])!=value.get('unscored',0):raise ValueError('Inconsistent score ID coverage '+key)
 return value
def optional_study(rows,expected,record_names,checkpoint=False):
 """An absent study is omitted; an observed partial study blocks publication."""
 paths=[HERE/'recorded'/f'{name}.json' for name in record_names]
 if not any(key in rows for key in expected) and not any(path.exists() for path in paths):return False
 for key,total in expected.items():require_metric(rows,key,total,allow_partial=checkpoint and key.startswith('longtrace-v2-pr115-'))
 for path,total in zip(paths,record_names.values()):
  if not path.exists():raise ValueError('Missing study record '+path.name)
  record=json.loads(path.read_text());answers=record.get('answers',[])
  name=path.name[:-5]
  partial=checkpoint and name=='longtrace-v2-pr115' and (record.get('complete') is False or any(key.startswith(name+'-') and rows[key].get('complete') is False for key in expected))
  if partial:
   if record.get('complete') not in [True,False] or record.get('expected')!=total or not 0<=len(answers)<=total:raise ValueError('Inconsistent checkpoint record '+path.name)
  elif record.get('complete') is not True or record.get('expected',total)!=total or len(answers)!=total:raise ValueError('Incomplete study record '+path.name)
  if len({answer['id'] for answer in answers})!=len(answers):raise ValueError('Duplicate study IDs '+path.name)
  for key in expected:
   matching=max((candidate for candidate in record_names if key==candidate or key.startswith(candidate+'-')),key=len,default=None)
   if matching!=name:continue
   value=rows[key]
   if partial:
    multiplier=2 if key.endswith('-criteria') else 1
    observed=value['total']-value.get('pending',-1)
    if value.get('complete') is not False or not 0<=observed<value['total'] or not observed<=len(answers)*multiplier or observed%multiplier or value['n']>observed:raise ValueError('Checkpoint coverage disagrees with raw records '+key)
    if set(value.get('wrong_ids',[]))&set(value.get('pending_ids',[])):raise ValueError('Pending checkpoint cases were scored as quality losses '+key)
   if all(field in value for field in ['correct_ids','wrong_ids','unscored_ids']):
    scored_ids=set(value['correct_ids']+value['wrong_ids']+value['unscored_ids'])
    if partial:scored_ids-=set(value.get('pending_ids',[]))
    raw_ids={answer['id'] for answer in answers}
    if key.endswith('-criteria'):raw_ids={identifier+'::'+str(index) for identifier in raw_ids for index in [0,1]}
    if (partial and (len(scored_ids)!=observed or not scored_ids<=raw_ids)) or (not partial and scored_ids!=raw_ids):raise ValueError('Summary/record ID mismatch '+key)
 return True
def require_pr115_sources(record_names):
 source_hashes=None
 for name in record_names:
  record=json.loads((HERE/'recorded'/f'{name}.json').read_text())
  if record.get('sourceCommit')!=PR115_SOURCE:raise ValueError('Unexpected PR 115 measured source '+name)
  hashes=record.get('sourceHashes')
  if not isinstance(hashes,dict) or not hashes or any(not isinstance(value,str) or re.fullmatch('[0-9a-f]{64}',value) is None for value in hashes.values()):raise ValueError('Missing or invalid PR 115 source hashes '+name)
  if any(path not in hashes for path in ['packages/judges/src/prompt.ts','packages/judges/src/assessment.ts','packages/judges/src/pairwise.ts']):raise ValueError('Incomplete PR 115 source manifest '+name)
  if source_hashes is not None and hashes!=source_hashes:raise ValueError('PR 115 source manifest differs between records '+name)
  source_hashes=hashes
def new_studies(rows):
 pr_records={'pairwise-pr115':120,'pairwise-pr115-heldout':60,'judges-pr115':120,'judges-pr115-heldout':60}
 pr_metrics={'pairwise-pr115':120,'pairwise-pr115-heldout':60,**{f'judges-pr115{tag}{suffix}':total for tag,total in [('',120),('-heldout',60)] for suffix in ['-primary','-vector']}}
 pr=optional_study(rows,pr_metrics,pr_records)
 # Seed 18 conformance and seed 14 longtrace plans were never called and are
 # superseded artifacts. They must not be presented as measured studies.
 conformance=False;longtrace=False
 source_records=list(pr_records) if pr else []
 if longtrace:source_records.append('longtrace-pr115')
 if source_records:require_pr115_sources(source_records)
 return pr,conformance,longtrace
def pr115_diagnosis():
 path=HERE/'pr115-misses.md'
 if not path.exists():return False
 text=path.read_text()
 return bool(text.strip() and re.search(r'(?im)^status:\s*complete\s*$',text))
def same_typescript_tokens(before,after):
 script=r'''const ts=require('typescript');const fs=require('fs');const input=JSON.parse(fs.readFileSync(0,'utf8'));function tree(node){const children=[];ts.forEachChild(node,child=>{children.push(tree(child));});return [node.kind,node.kind!==ts.SyntaxKind.SourceFile&&typeof node.text==='string'?node.text:null,children];}function tokens(text){const source=ts.createSourceFile('check.mts',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);if(source.parseDiagnostics.length)throw Error('Invalid TypeScript');const result=[];function walk(node){const children=node.getChildren(source);if(children.length){for(const child of children)walk(child);return;}if([ts.SyntaxKind.EndOfFileToken,ts.SyntaxKind.SyntaxList].includes(node.kind))return;const literal=[ts.SyntaxKind.StringLiteral,ts.SyntaxKind.NumericLiteral,ts.SyntaxKind.BigIntLiteral,ts.SyntaxKind.NoSubstitutionTemplateLiteral,ts.SyntaxKind.TemplateHead,ts.SyntaxKind.TemplateMiddle,ts.SyntaxKind.TemplateTail].includes(node.kind);result.push([node.kind,literal?node.text:node.getText(source)]);}walk(source);const normalized=result.filter((token,index)=>!(token[0]===ts.SyntaxKind.CommaToken&&[ts.SyntaxKind.CloseBraceToken,ts.SyntaxKind.CloseBracketToken].includes(result[index+1]?.[0])));return [normalized,tree(source)];}process.stdout.write(JSON.stringify(tokens(input[0]))===JSON.stringify(tokens(input[1]))?'true':'false');'''
 result=subprocess.run(['node','-e',script],input=json.dumps([before.decode(),after.decode()]),cwd=ROOT,text=True,capture_output=True,check=True)
 return result.stdout=='true'
def format_migration(rows,current_freeze):
 path=HERE/'final-format-migration.json'
 if not path.exists():return None
 certificate=json.loads(path.read_text());original=certificate.get('originalFreeze')
 archived=json.loads((HERE/'pre-final-format/adapter-v2-freeze.json.txt').read_text())
 if not isinstance(original,dict) or archived!=original:raise ValueError('Missing or mismatched original formatting freeze archive')
 original_hashes=original.get('hashes')
 if not isinstance(original_hashes,dict) or not original_hashes:raise ValueError('Missing original formatting source hashes')
 # Formatting is accepted only after both complete populations finish.
 request_count=0
 for prefix in ['adapter-v2','longtrace-v2']:
  expected={f'{prefix}-{variant}{suffix}':total for variant in CRITERION_VARIANTS for suffix,total in [('-criteria',240),('-primary',120),('-receipt',120),('-vector',120)]}
  if not optional_study(rows,expected,{f'{prefix}-{variant}':120 for variant in CRITERION_VARIANTS}):raise ValueError('Formatting migration precedes all measured cohorts')
  for variant in CRITERION_VARIANTS:
   record=json.loads((HERE/'recorded'/f'{prefix}-{variant}.json').read_text())
   if record.get('procedureHashes')!=original_hashes:raise ValueError('Formatting changed recorded original procedure hashes')
   for answer in record['answers']:
    references=answer.get('request_sha256s')
    if not isinstance(references,list) or not references or any(not isinstance(value,str) or re.fullmatch('[0-9a-f]{64}',value) is None for value in references):raise ValueError('Missing recorded requests for formatting verification')
    request_count+=len(references)
 if certificate.get('unchangedModelInputs') is not True or type(certificate.get('verifiedRequestCount')) is not int or certificate['verifiedRequestCount']!=request_count:raise ValueError('Incomplete formatting model-input certificate')
 changes=certificate.get('changes')
 if not isinstance(changes,list) or not changes:raise ValueError('Missing canonical formatting changes')
 originals={};canonical=dict(original_hashes)
 for change in changes:
  name=change.get('path');relative=pathlib.PurePosixPath(name) if isinstance(name,str) else None
  if relative is None or relative.is_absolute() or '..' in relative.parts or name not in original_hashes or name in originals:raise ValueError('Invalid or duplicate formatting path')
  before=(HERE/'pre-final-format'/str(relative.parent)/(relative.name+'.txt')).read_bytes();after=(HERE/name).read_bytes()
  if change.get('beforeSha256')!=original_hashes[name] or hashlib.sha256(before).hexdigest()!=change['beforeSha256'] or hashlib.sha256(after).hexdigest()!=change.get('afterSha256'):raise ValueError('Formatting original/canonical SHA mismatch '+name)
  if change.get('semanticEqual') is not True:raise ValueError('Unverified semantic formatting change '+name)
  if change.get('kind')=='json' and relative.suffix=='.json':
   if json.dumps(json.loads(before),sort_keys=True)!=json.dumps(json.loads(after),sort_keys=True):raise ValueError('Formatting changed JSON data or labels '+name)
  elif change.get('kind')=='typescript' and relative.suffix in ['.ts','.mts']:
   if not same_typescript_tokens(before,after):raise ValueError('Formatting changed TypeScript significant tokens '+name)
  else:raise ValueError('Unsupported formatting artifact kind '+name)
  originals[name]=before;canonical[name]=change['afterSha256']
 if current_freeze.get('hashes') not in [original_hashes,canonical]:raise ValueError('Current formatting freeze hash map changed outside certificate')
 if current_freeze.get('hashes')!=original_hashes and not current_freeze.get('storageFormatting'):raise ValueError('Canonical freeze lacks formatting annotation')
 old_metadata={key:value for key,value in original.items() if key not in ['hashes','storageFormatting']}
 current_metadata={key:value for key,value in current_freeze.items() if key not in ['hashes','storageFormatting']}
 if old_metadata!=current_metadata:raise ValueError('Formatting changed original freeze metadata')
 for name,digest in original_hashes.items():
  if name not in originals and hashlib.sha256((HERE/name).read_bytes()).hexdigest()!=digest:raise ValueError('Uncertified frozen source drift '+name)
 return {'originalFreeze':original,'originals':originals,'verifiedRequestCount':request_count}
def fixed_adapter_studies(rows,checkpoint=False):
 measured={};checked_stamps=set();migration_checked=False;migration=None
 for prefix,fixture,seed in [('adapter-v2','judges-entries-v2.json',20261019),('longtrace-v2','longtrace-v2/hard.json',20261020)]:
  expected={f'{prefix}-{variant}{suffix}':total for variant in CRITERION_VARIANTS for suffix,total in [('-criteria',240),('-primary',120),('-receipt',120),('-vector',120)]}
  if not optional_study(rows,expected,{f'{prefix}-{variant}':120 for variant in CRITERION_VARIANTS},checkpoint=checkpoint):continue
  freeze=json.loads((HERE/'adapter-v2-freeze.json').read_text())
  if not migration_checked:migration=format_migration(rows,freeze);migration_checked=True
  if migration:freeze=migration['originalFreeze']
  hashes=freeze.get('hashes')
  if not isinstance(hashes,dict) or not hashes or any(not isinstance(value,str) or re.fullmatch('[0-9a-f]{64}',value) is None for value in hashes.values()):raise ValueError('Invalid adapter v2 freeze manifest')
  if any(name not in hashes for name in ['trusted-adapter-v2.mts','criteria-v2.mts',fixture]):raise ValueError('Incomplete adapter v2 freeze manifest')
  fixture_bytes=migration['originals'].get(fixture,(HERE/fixture).read_bytes()) if migration else (HERE/fixture).read_bytes()
  digest=hashlib.sha256(fixture_bytes).hexdigest()
  if hashes[fixture]!=digest:raise ValueError('Frozen adapter v2 fixture changed '+prefix)
  stamps={}
  for variant in CRITERION_VARIANTS:
   record=json.loads((HERE/'recorded'/f'{prefix}-{variant}.json').read_text())
   if record.get('adapterVersion')!=2 or record.get('seed')!=seed:raise ValueError('Wrong adapter version/seed '+prefix+'-'+variant)
   stamp=record.get('registrationCommit','')
   if not isinstance(stamp,str) or re.fullmatch('[0-9a-f]{40}',stamp) is None:raise ValueError('Missing adapter v2 registration commit '+prefix+'-'+variant)
   if record.get('fixtureSha256')!=digest or record.get('procedureHashes')!=hashes:raise ValueError('Adapter v2 fixture/procedure stamp mismatch '+prefix+'-'+variant)
   if (stamp,fixture) not in checked_stamps:
    def committed(path):
     return subprocess.check_output(['git','show',stamp+':comparisons/langwatch/hard/'+path],cwd=ROOT)
    registered=json.loads(committed('adapter-v2-freeze.json'))
    if registered.get('hashes')!=hashes:raise ValueError('Registration freeze differs from recorded procedure hashes '+prefix)
    for path in [fixture,'trusted-adapter-v2.mts','criteria-v2.mts']:
     if hashlib.sha256(committed(path)).hexdigest()!=hashes[path]:raise ValueError('Preregistration artifact hash mismatch '+path)
    checked_stamps.add((stamp,fixture))
   stamps[variant]=stamp
  measured[prefix]={'seed':seed,'fixture':fixture,'fixtureSha256':digest,'registrationCommits':stamps,'formatMigrationVerifiedRequests':migration['verifiedRequestCount'] if migration else None,'checkpointPartial':checkpoint and prefix=='longtrace-v2' and rows['longtrace-v2-pr115-primary'].get('complete') is False}
 if measured:require_pr115_sources([prefix+'-pr115' for prefix in measured])
 return measured
def corrected_outcome(rows,prefix,suffix):
 candidate=require_metric(rows,prefix+'-compliance'+suffix);native=require_metric(rows,prefix+'-theirs'+suffix)
 if candidate['n']!=candidate['total'] or native['n']!=native['total']:return 'in progress; incomplete scored coverage'
 if candidate['correct']==native['correct']==candidate['total']==native['total']:return 'tie at measured ceiling'
 return 'ahead' if candidate['correct']>native['correct'] else 'behind' if candidate['correct']<native['correct'] else 'equal'
def corrected_cohort_outcome(rows,prefix):
 parts=[]
 for suffix,label in [('-criteria','all 240 criterion labels'),('-primary','all 120 primary cases'),('-vector','all 120 complete vectors')]:
  candidate=require_metric(rows,prefix+'-compliance'+suffix);native=require_metric(rows,prefix+'-theirs'+suffix)
  parts.append(f"{label}: conformance {candidate['correct']}/{candidate['n']}, native {native['correct']}/{native['n']} ({corrected_outcome(rows,prefix,suffix)})")
 return '; '.join(parts)+'. These are recorded cohort outcomes, not population-level superiority claims.'
def corrected_top_detail(rows,suffix):
 parts=[]
 for prefix,label in [('adapter-v2','Short, new seed 20261019'),('longtrace-v2','Long, new seed 20261020')]:
  candidate=require_metric(rows,prefix+'-compliance'+suffix);native=require_metric(rows,prefix+'-theirs'+suffix)
  costs=[]
  for variant in ['compliance','theirs']:
   value=require_metric(rows,prefix+'-'+variant+'-primary');costs.append('unscored' if not value['n'] else f"{100*value['attributableUsd']/value['n']:.8f}")
  parts.append(f"{label}: conformance {candidate['correct']}/{candidate['n']}, native {native['correct']}/{native['n']}; {corrected_outcome(rows,prefix,suffix)}. Model USD per 100 cases conformance/native: {'/'.join(costs)}.")
 return ' '.join(parts)
def short_pr115_diagnosis(rows,link_prefix=''):
 path=HERE/'adapter-v2-pr115-misses.md'
 if not path.exists():return ''
 text=path.read_text()
 if not re.search(r'(?im)^status:\s*complete for new short seed20261019\.',text):return ''
 raw=json.loads((HERE/'recorded/adapter-v2-pr115-misses.json').read_text())
 expected={'judge-coverage_order-06':True,'judge-conditional_promise-10':False}
 primary=require_metric(rows,'adapter-v2-pr115-primary',120)
 if not isinstance(raw,list) or {entry['case']['id'] for entry in raw}!=set(expected) or len(raw)!=len(expected) or set(primary['wrong_ids'])!=set(expected):raise ValueError('Short PR 115 diagnosis does not match recorded misses')
 for entry in raw:
  answer=entry['recordedAnswer'];call=entry['rawCalls'][0];check=json.loads(call['text'])['checks'][0]
  if entry.get('adapterVersion')!=2 or entry.get('cohort')!='new-seed20261019' or answer['id']!=entry['case']['id'] or answer['predictions'][0] is not None or answer['details'][0].get('unparsed') is not True:raise ValueError('Short PR 115 diagnosis has inconsistent parsed loss')
  if call.get('failed') is not False or call.get('cliType')!='result' or call.get('cliSubtype')!='success' or call.get('cliIsError') is not False or check.get('met') is not expected[answer['id']]:raise ValueError('Short PR 115 diagnosis lacks successful CLI/correct semantic flag')
  if call.get('request_sha256')!=answer['request_sha256s'][0] or 'the evidence quote is not in the supplied data' not in answer['details'][0]['answer']['reasoning']:raise ValueError('Short PR 115 diagnosis lacks matching strict-parser evidence')
 return f"Completed [short-seed PR 115 miss analysis]({link_prefix}adapter-v2-pr115-misses.md) and [full inputs/raw calls]({link_prefix}recorded/adapter-v2-pr115-misses.json) identify two evidence-contract losses: `judge-coverage_order-06` quotes frame metadata and synthesizes a chronology quote; `judge-conditional_promise-10` stitches context and agent quotes across entries. Both CLI calls succeed and semantic `met` flags are correct, but the strict request-aware parser rejects the evidence strings as ungrounded. These remain scored invalid-output losses. This diagnosis applies only to new short seed 20261019; no long-cohort cause is claimed."
def long_pr115_diagnosis(rows,link_prefix=''):
 path=HERE/'longtrace-v2/pr115-misses.md'
 if not path.exists():return ''
 text=path.read_text()
 if not re.search(r'(?im)^status:\s*complete\.',text):return ''
 raw=json.loads((HERE/'recorded/longtrace-v2-pr115-misses.json').read_text())
 primary=require_metric(rows,'longtrace-v2-pr115-primary',120);criteria=require_metric(rows,'longtrace-v2-pr115-criteria',240);receipt=require_metric(rows,'longtrace-v2-pr115-receipt',120)
 if raw.get('status')!='complete' or raw.get('observedCases')!=120 or raw.get('expectedCases')!=120 or raw.get('sourceCommit')!=PR115_SOURCE:raise ValueError('Long PR 115 diagnosis is incomplete or from another source')
 misses=raw.get('misses',[])
 if len(misses)!=raw.get('missedCases') or {entry['id'] for entry in misses}!=set(primary['wrong_ids']) or raw.get('missedCriteria')!=criteria['n']-criteria['correct']:raise ValueError('Long PR 115 diagnosis does not match observed misses')
 classes=raw.get('exclusiveCauseClasses',{})
 expected={'strict_quote_rejection':25,'reference_tool_requirement_expansion':9,'monthly_scope_qualification':1}
 if classes!=expected or any(sum(entry.get('primaryClass')==key for entry in misses)!=count for key,count in classes.items()):raise ValueError('Long PR 115 diagnosis class counts disagree')
 if primary['correct']!=85 or criteria['correct']!=205 or receipt['correct']!=120 or any(entry.get('criterionIndex')!=0 or entry.get('fullRequestMatchesTrustedFixture') is not True for entry in misses):raise ValueError('Long PR 115 diagnosis score/scope mismatch')
 return f"Completed [long-seed PR 115 miss analysis]({link_prefix}longtrace-v2/pr115-misses.md) and [full inputs/raw calls]({link_prefix}recorded/longtrace-v2-pr115-misses.json) cover all 35 primary losses: 25 strict quote rejections, nine reference-tool requirement expansions and one monthly-scope qualification. All 120 receipt criteria pass. Twenty-four raw semantic decisions match frozen truth but retain their strict-parser losses. The reference-tool and monthly-scope cases expose fixture/rubric interpretation concerns; the diagnosis does not declare labels wrong or rescore results."
def render_fixed_adapter_studies(rows,studies,link_prefix=''):
 sections=[]
 labels={'ours':'Old main default','audit':'Original audit candidate','theirs':'Native default','compliance':'Conformance candidate','pr115':'PR 115 default'}
 for prefix,study in studies.items():
  title='Trusted event adapter v2' if prefix=='adapter-v2' else 'Preregistered long traces v2'
  lines=['## '+title,'',f"New seed {study['seed']}: all 120 cases and all 240 constructed criterion labels are fixed before calls. Trusted event roles come from fixture construction; role-like text stays literal inside its owning entry. Every procedure runs once with unchanged prompts and decoders. Audit and conformance remain candidates, not yet the shipped default. This cohort is separate from the retained defective-adapter results; no old labels, losses or pairwise measurements are revised.",'','| Metric | '+' | '.join(labels[variant] for variant in CRITERION_VARIANTS)+' |','|---|---|---|---|---|---|']
  for suffix,label in [('-criteria','Primary: all 240 criteria'),('-primary','Primary criterion: all 120 cases'),('-receipt','Secondary: receipt, all 120 cases'),('-vector','Secondary: complete vector, all 120 cases')]:
   cells=[]
   for variant in CRITERION_VARIANTS:
    partial=study.get('checkpointPartial') and variant=='pr115'
    value=require_metric(rows,prefix+'-'+variant+suffix,allow_partial=partial);lo,hi=value['ci95'];interval='unscored' if lo is None else f'{100*lo:.2f}% to {100*hi:.2f}%'
    cells.append(f"{value['correct']}/{value['n']} (Wilson 95% {interval}; coverage {value['n']}/{value['total']})")
    if partial:cells[-1]+=' [checkpoint; '+str(value['n'])+' scored, '+str(value.get('pending',0))+' pending]'
   lines.append('| '+label+' | '+' | '.join(cells)+' |')
  lines+=['',('Short-cohort outcome: ' if prefix=='adapter-v2' else 'Long-cohort outcome: ')+corrected_cohort_outcome(rows,prefix)]
  if study.get('checkpointPartial'):lines+=['','PR 115 long-cohort coverage is partial in this checkpoint under the unchanged freeze. This checkpoint scores only recorded answers and shows coverage against the complete 120-case population. Pending cases are not quality losses. No whole-cohort PR 115 ranking or completion is claimed. The other four long contestants and every short contestant are complete. Only this final continuation permits up to six concurrent model calls through 06:35 local time under the authorized 16 USD cap; earlier contestant runs remain serial. No formatting migration is permitted while this run is partial.']
  diagnosis=short_pr115_diagnosis(rows,link_prefix) if prefix=='adapter-v2' else ('' if study.get('checkpointPartial') else long_pr115_diagnosis(rows,link_prefix))
  if diagnosis:lines+=['',diagnosis]
  lines+=['','| Procedure | Model USD per 100 cases | Attributable model USD | Registration commit |','|---|---|---|---|']
  for variant in CRITERION_VARIANTS:
   value=require_metric(rows,prefix+'-'+variant+'-primary',allow_partial=study.get('checkpointPartial') and variant=='pr115');cost='unscored' if not value['n'] else f"{100*value['attributableUsd']/value['n']:.8f}"
   lines.append('| '+labels[variant]+' | '+cost+f" | {value['attributableUsd']:.8f} | `{study['registrationCommits'][variant]}` |")
  lines+=['',f"Fixture SHA-256: `{study['fixtureSha256']}`. The complete adapter/procedure hashes match the original preregistered freeze; PR 115 uses source `{PR115_SOURCE}`. Metric views reuse each recorded cohort run, so costs are not added again for receipt/vector/criterion views. Invalid quality verdicts remain losses; recorded unrecovered transport failures remain unscored with full coverage shown. Shared synthetic families limit generalization.",'',f"Protocol: [trusted adapter contract]({link_prefix}ADAPTER-V2-CONTRACT.md)."+(f" [Long v2 preregistration]({link_prefix}longtrace-v2/PREREGISTRATION.md)." if prefix=='longtrace-v2' else '')]
  if study.get('formatMigrationVerifiedRequests') is not None:lines+=['',f"Post-run storage formatting is verified separately in [formatting migration]({link_prefix}final-format-migration.json): archived original bytes and registration commits retain the measured hashes, JSON labels are deeply equal, TypeScript significant tokens agree, and the root verifier certifies unchanged model inputs for all {study['formatMigrationVerifiedRequests']} recorded request references. Canonical formatting does not replace the original measurement stamps."]
  sections.append('\n'.join(lines)+'\n\n')
 return ''.join(sections)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--checkpoint',action='store_true');args=parser.parse_args()
 data=json.loads((HERE/'recorded/summary.json').read_text());r=data['rows'];today=datetime.datetime.now(zoneinfo.ZoneInfo('Europe/Brussels')).strftime('%Y-%m-%d')
 pr115,conformance,longtrace=new_studies(r)
 fixed=fixed_adapter_studies(r,checkpoint=args.checkpoint)
 def metric(kind,variant,cohort='',suffix=''):
  return require_metric(r,f'{kind}-{variant}{cohort}{suffix}')
 def count(v):return f"{v['correct']}/{v['n']} (coverage {v['n']}/{v['total']})"
 def ci(v):return 'unscored' if v['ci95'][0] is None else f"{100*v['ci95'][0]:.2f}% to {100*v['ci95'][1]:.2f}%"
 def cost(v):return 'unscored' if not v['n'] else f"{100*v['attributableUsd']/v['n']:.6f}"
 def outcome(c,d,ch,dh):
  if any(not v['n'] for v in [c,d,ch,dh]):return 'unscored'
  a=c['correct']/c['n'];b=d['correct']/d['n'];x=ch['correct']/ch['n'];y=dh['correct']/dh['n']
  return 'ahead' if a>b and x>y else 'equal' if a==b and x==y else 'behind' if x<y else 'in progress'
 def triples(kind,candidate,suffix=''):
  native='native' if kind=='pii' else 'theirs'
  hard=[metric(kind,v,'',suffix) for v in ['ours',candidate,native]]
  fresh=[metric(kind,v,'-heldout',suffix) for v in ['ours',candidate,native]]
  return hard,fresh
 def detail(h,f):return f"Hard: shipped {count(h[0])}, candidate {count(h[1])}, default {count(h[2])}. Fresh seed 20261013: shipped {count(f[0])}, candidate {count(f[1])}, default {count(f[2])}. Candidate/default fresh Wilson 95%: {ci(f[1])} / {ci(f[2])}. Model USD per 100 (shipped/candidate/default): hard {cost(h[0])}/{cost(h[1])}/{cost(h[2])}; fresh {cost(f[0])}/{cost(f[1])}/{cost(f[2])}."
 updates={}
 for name,suffix in [('Per-criterion judge rules','-primary'),('Judge verdict prompt','-vector')]:
  h,f=triples('judges','audit',suffix);result='defective adapter';what=OLD_CRITERION_LIMIT+' '+('Primary-requirement accuracy; receipt labels vary independently.' if suffix=='-primary' else 'Both criterion verdicts must be correct; aggregate success can hide individual errors.')
  updates[name]=f"| {name} | {result} | {today}; frozen evidence audit candidate, **not yet the shipped default**, versus exact native default prompt/schema | {detail(h,f)} {what} Empty native CLI results get transport recovery; unrecovered cases are unscored with coverage recorded. | `python3 comparisons/langwatch/hard/score.py`; all three variants and replay commands in `comparisons/langwatch/hard/README.md`. |"
  if all(prefix in fixed for prefix in ['adapter-v2','longtrace-v2']):
   corrected_suffix='-criteria' if suffix=='-primary' else '-vector'
   short=corrected_outcome(r,'adapter-v2',corrected_suffix);long=corrected_outcome(r,'longtrace-v2',corrected_suffix)
   status=short if short==long else 'short '+short+'; long '+long
   updates[name]=f"| {name} | {status} | {today}; corrected trusted-event adapter v2; conformance candidate **not yet the shipped default**, versus native default; PR 115 is a separate approved-source default at `{PR115_SOURCE}` | {corrected_top_detail(r,corrected_suffix)} Short: {corrected_cohort_outcome(r,'adapter-v2')} Long: {corrected_cohort_outcome(r,'longtrace-v2')} Every original criterion score, including 119/120 and 59/60, remains in the defective-adapter historical grids. | Full old main/audit/native/conformance/PR 115 tables: [short](#trusted-event-adapter-v2) and [long](#preregistered-long-traces-v2). `python3 comparisons/langwatch/hard/score.py`. |"
   if fixed['longtrace-v2'].get('checkpointPartial'):updates[name]=updates[name].replace('corrected trusted-event adapter v2;','checkpoint: PR 115 long run remains partial; corrected trusted-event adapter v2;')
 h,f=triples('simulator','checked');updates['Simulated user prompt']=f"| Simulated user prompt | {outcome(h[1],h[2],f[1],f[2])} | {today}; intent-gated candidate, **not yet the shipped default**, versus exact default text prompt | {detail(h,f)} A requested email must be supplied, otherwise withheld. This is one-step disclosure; native reversed history is coalesced for the CLI. | `python3 comparisons/langwatch/hard/score.py`; `simulator.mts` hard/fresh replay in the hard README. |"
 h,f=triples('pii','audit');eh,ef=triples('pii','audit','-enabled');updates['PII detection']=f"| PII detection | {outcome(h[1],h[2],f[1],f[2])} | {today}; full-scope audit candidate, **not yet the shipped default**, versus actual native Presidio defaults | {detail(h,f)} Enabled-scope subset, shipped/candidate/native: hard {count(eh[0])}/{count(eh[1])}/{count(eh[2])}; fresh {count(ef[0])}/{count(ef[1])}/{count(ef[2])}. Native PERSON/LOCATION defaults disable thirty name/home positives on hard and fourteen on fresh; every ID is named in `comparisons/langwatch/hard/native-scope-misses.md`. Remaining native misses: two phones on hard, one on fresh. Native en_core_web_lg 3.7.1, spaCy 3.7.5, Presidio 2.2.364. The full margin includes scope differences. The shipped component baseline uses the explicit reserved-domain benchmark opt-in; the bare name/address judge and its declared scope are recorded separately. | `python3 comparisons/langwatch/hard/score.py`; native adapters and pinned dependencies in `comparisons/langwatch/hard/pii/README.md`. |"
 sh=metric('injection','ours');ch=metric('injection','audit');sf=metric('injection','ours','-heldout');cf=metric('injection','audit','-heldout')
 updates['Prompt-injection and jailbreak detection']=f"| Prompt-injection and jailbreak detection | in progress | {today}; measured frozen target/action audit candidate, **not yet the shipped default**; native unmeasured | Hard: shipped {count(sh)}, candidate {count(ch)}. Fresh: shipped {count(sf)}, candidate {count(cf)} (95% {ci(cf)}). Model USD per 100 shipped/candidate: hard {cost(sh)}/{cost(ch)}; fresh {cost(sf)}/{cost(cf)}. LangWatch's defaults use Azure Content Safety Jailbreak Detection and Prompt Shield. Both native sets stay unmeasured without Azure keys; no proxy or competitor accuracy is inferred. | `python3 comparisons/langwatch/hard/score.py`; runnable native adapter in `comparisons/langwatch/hard/injection/README.md`. |"
 h,f=triples('pairwise','checked');updates['Pairwise comparison']=f"| Pairwise comparison | {outcome(h[1],h[2],f[1],f[2])} | {today}; audit plus fact-ledger candidate, **not yet the shipped default**, versus native golden-aware default | {detail(h,f)} Both orders are scored. The previous 120/120 is the development result; the fresh sixty-pair result is separate. Easy cohort: candidate/default both 120/120. | `python3 comparisons/langwatch/hard/score.py`; hard replay in `pairwise/AUDIT.md`, fresh replay in the hard README. |"
 path=ROOT/'docs/comparison/langwatch.md';body=path.read_text();lines=[]
 for line in body.splitlines():
  if line.startswith('| '):line=updates.get(line.split('|')[1].strip(),line)
  lines.append(line)
 body='\n'.join(lines)+'\n';header='## Measurement limits' if '## Measurement limits' in body else '## Not compared';start=body.index(header)
 repairsection=''
 if optional_study(r,{'injection-attempt':120,'injection-ours-heldout-v2':60,'injection-attempt-heldout-v2':60},{'injection-attempt':120,'injection-ours-heldout-v2':60,'injection-attempt-heldout-v2':60}):
  repairsection='## Attempt-aware injection repair\n\nThe original audit loss remains above. The attempt-aware V2 candidate is **not yet the shipped default**. It classifies what the user attempts, regardless of whether the auditor refuses or executes it.\n\n| Cohort | Shipped | Attempt-aware V2 | Native default |\n|---|---|---|---|\n'
  for tag,label in [('', 'Hard'),('-heldout-v2','New fresh 60, seed 20261017')]:
   values=[metric('injection',v,tag) for v in ['ours','attempt']]
   repairsection+='| '+label+' | '+' | '.join(count(v)+' (95% '+ci(v)+')' for v in values)+' | Azure unmeasured |\n'
  hard=[metric('injection',v) for v in ['ours','attempt']];fresh=[metric('injection',v,'-heldout-v2') for v in ['ours','attempt']]
  repairsection+='\nModel USD per 100 shipped/V2: hard '+ '/'.join(cost(v) for v in hard)+'; fresh '+ '/'.join(cost(v) for v in fresh)+'. The unchanged generator fixes new labels before calls, with zero text overlap against prior cohorts. No held-out tuning or native proxy occurs. See `INJECTION-ATTEMPT-PROTOCOL.md`.\n\n'
 prsection=''
 if pr115:
  source=json.loads((HERE/'recorded/pairwise-pr115.json').read_text())['sourceCommit']
  prsection=f'## Approved PR 115 pairwise default\n\nThe original shipped-contract result stays above. PR 115 is approved to replace it once CI is green; this section does not assert that it is merged or current. The actual measured source is `{source}`. The ignored source checkout is excluded from this comparison commit.\n\n| Cohort | Original shipped contract | PR 115 default | Audit candidate | Native default |\n|---|---|---|---|---|\n'
  prcosts=[]
  for tag,label in [('', 'Hard 120'),('-heldout','Fresh 60, seed 20261013')]:
   values=[metric('pairwise',v,tag) for v in ['ours','pr115','checked','theirs']]
   prsection+='| '+label+' | '+' | '.join(count(v)+' (95% '+ci(v)+')' for v in values)+' |\n'
   prcosts.append('Model USD per 100, original/PR 115/audit/native ('+label+'): '+ '/'.join(cost(v) for v in values)+'.')
  prsection+='\n'+'\n\n'.join(prcosts)+'\n\n'
 prcriteriasection=''
 if pr115:
  source=json.loads((HERE/'recorded/judges-pr115.json').read_text())['sourceCommit']
  prcriteriasection=f'## Approved PR 115 criterion default\n\nThe same approved-source round also measures PR 115\'s actual criterion default at `{source}`. Old main shipped, original audit candidate, native default and PR 115 stay separate. The frozen fresh cohort is the original 60-case draw at seed 20261013; its labels and original losses are unchanged. This is an approved-source measurement, not a claim that the PR is merged or current.\n\n| Cohort and metric | Old main shipped | Original audit candidate | Native default | PR 115 default |\n|---|---|---|---|---|\n'
  criteriacosts=[]
  for tag,label in [('', 'Hard 120'),('-heldout','Frozen fresh 60, seed 20261013')]:
   for suffix,name in [('-primary','Primary criterion'),('-vector','Complete vector')]:
    values=[metric('judges',variant,tag,suffix) for variant in ['ours','audit','theirs','pr115']]
    prcriteriasection+='| '+label+', '+name+' | '+' | '.join(count(value)+' (95% '+ci(value)+')' for value in values)+' |\n'
   criteriacosts.append('Model USD per 100, old main/audit/native/PR 115 ('+label+'): '+ '/'.join(cost(metric('judges',variant,tag,'-primary')) for variant in ['ours','audit','theirs','pr115'])+'. Both metric views reuse the same run attribution.')
  prcriteriasection+='\n'+'\n\n'.join(criteriacosts)+'\n\n'
  prcriteriasection+='| Procedure | Hard primary / vector | Frozen fresh primary / vector |\n|---|---|---|\n'
  for variant,label in [('ours','Old main shipped'),('audit','Original audit candidate, not yet shipped'),('theirs','Native default'),('pr115','PR 115 default')]:
   prcriteriasection+='| '+label+' | '+count(metric('judges',variant,'','-primary'))+' / '+count(metric('judges',variant,'','-vector'))+' | '+count(metric('judges',variant,'-heldout','-primary'))+' / '+count(metric('judges',variant,'-heldout','-vector'))+' |\n'
  prcriteriasection+='\n'
  prcriteriasection+=OLD_CRITERION_LIMIT+' All old main/audit/native/PR 115 hard/fresh values, including 119/120 and 59/60, remain unchanged.\n\n'
  if pr115_diagnosis():prcriteriasection+='Completed [PR 115 miss analysis](../../comparisons/langwatch/hard/pr115-misses.md) records cross-entry evidence stitching on hard and a deciding-evidence gap treated as vacuous compliance on fresh. Mixed-role adapter framing limits the latter conclusion.\n\n'
 conformsection=''
 if conformance:
  conformsection='## Conformance judge candidate\n\nThe original audit hard/fresh losses stay above. Conformance is a separate candidate, **not yet the shipped default**. It checks requirement compliance, including prohibitions and criterion-specific deciding events. New fresh seed 20261018 uses the unchanged generator and 60 fixed labels, frozen before calls.\n\n| Cohort and metric | Shipped | Original audit | Conformance candidate | Native default |\n|---|---|---|---|---|\n'
  conformcosts=[]
  for tag,label in [('', 'Hard 120'),('-heldout-v2','New fresh 60, seed 20261018')]:
   for suffix,name in [('-primary','Primary criterion'),('-vector','Complete vector')]:
    values=[metric('judges',v,tag,suffix) for v in ['ours','compliance','theirs']]
    old=count(metric('judges','audit','',suffix))+' (95% '+ci(metric('judges','audit','',suffix))+')' if not tag else 'not rerun; original fresh above'
    conformsection+='| '+label+', '+name+' | '+count(values[0])+' (95% '+ci(values[0])+') | '+old+' | '+count(values[1])+' (95% '+ci(values[1])+') | '+count(values[2])+' (95% '+ci(values[2])+') |\n'
   variants=['ours','audit','compliance','theirs'] if not tag else ['ours','compliance','theirs']
   conformcosts.append('Model USD per 100, '+ '/'.join(variants)+' ('+label+'): '+ '/'.join(cost(metric('judges',v,tag,'-primary')) for v in variants)+'. Costs are per cohort run, not charged again for the vector metric.')
  conformsection+='\n'+'\n\n'.join(conformcosts)+'\n\n'
 longsection=''
 if longtrace:
  source=json.loads((HERE/'recorded/longtrace-pr115.json').read_text())['sourceCommit']
  longsection=f'## Preregistered long traces\n\nThe original hard/fresh results stay above. Native ceiling measurements are separate from each candidate\'s actual losses. All five procedures run once on the registered cohort; PR 115 uses its actual default at `{source}`. Deciding evidence appears early among multiple tools and distractor receipts; no procedure is tuned after outcomes.\n\n| Metric | Shipped | Original audit candidate | Native default | Conformance candidate, not yet shipped | PR 115 default |\n|---|---|---|---|---|---|\n'
  for suffix,label in [('-criteria','Primary metric: all 240 individual criteria'),('-primary','Primary criterion: all 120 cases'),('-receipt','Secondary: receipt criterion, all 120 cases'),('-vector','Secondary: complete vector, all 120 cases')]:
   values=[metric('longtrace',v,'',suffix) for v in ['ours','audit','theirs','compliance','pr115']]
   longsection+='| '+label+' | '+' | '.join(count(v)+' (95% '+ci(v)+')' for v in values)+' |\n'
  values=[metric('longtrace',v,'','-primary') for v in ['ours','audit','theirs','compliance','pr115']]
  longsection+='\nModel USD per 100 cases, shipped/audit/native/conformance/PR 115: '+ '/'.join(cost(v) for v in values)+'. See `longtrace/PREREGISTRATION.md` and `recorded/summary.json` for the commit stamp, primary confusion matrices and complete family scores. All losses remain published.\n\n'
 # Replace previously generated sections on rerun instead of duplicating them.
 starts=[body.find('## '+title) for title in ['Attempt-aware injection repair','Approved PR 115 pairwise default','Approved PR 115 criterion default','Conformance judge candidate','Preregistered long traces','Trusted event adapter v2','Superseded unmeasured criterion plans']]
 start=min([start]+[position for position in starts if position>=0])
 superseded='## Superseded unmeasured criterion plans\n\nConformance seed 20261018 and long-trace seed 20261014 are retained construction artifacts. Neither plan was called; neither has measured accuracy. They are superseded by the trusted-event seed 20261019 and long v2 seed 20261020 cohorts. No old mixed-role criterion result is a reliable pure-quality comparison.\n\n'
 body=body[:start]+prsection+prcriteriasection+repairsection+superseded+render_fixed_adapter_studies(r,fixed,'../../comparisons/langwatch/hard/')+'''## Measurement limits

- Candidates are not yet the shipped default. Corrected criterion rows use the complete new short/long cohorts; original hard/fresh counts remain in the qualified historical grids.
- Original fresh cohorts use seed 20261013; injection repair uses 20261017. Trusted-event validation uses seed 20261019 and long v2 uses 20261020. Old seed 20261018/20261014 plans remain unmeasured. Labels and candidate procedures are frozen before calls. No held-out tuning occurs.
- Every old criterion comparison uses the defective mixed-role adapter. All counts, including 119/120 and 59/60, remain unchanged as historical records; they do not establish pure judge-quality rankings.
- Shared generator families are correlated. Wilson intervals describe these instances and do not prove population-level superiority.
- Empty native CLI output is a transport failure. Recovery precedes scoring; unrecovered cases remain unscored with coverage shown.
- Native Azure classifiers and OpenAI moderation remain unmeasured in this round. Dry source parity proves request construction, not live accuracy.
- Native PII disabled entities account for thirty hard and fourteen fresh misses. Enabled-scope scores appear separately.
- Hard Sonnet, Scenario decision/cache runtime and live trace import are not measured in this round.
- The `request_sha256` field migration is storage-only: request hash values, input bytes, outcomes and attributed costs remain unchanged. Original parent history is retained.
- Sanitization findings: [initial scan](../../comparisons/langwatch/hard/recorded/gitleaks-before.json) and [long-trace scan](../../comparisons/langwatch/hard/recorded/gitleaks-longtrace-before.json). See [final verification](../../comparisons/langwatch/hard/verification.md) for actual scan/check results; these links do not assert a scan pass.
'''
 assert '\u2014' not in body and '\u2013' not in body;path.write_text(body)
if __name__=='__main__':main()
