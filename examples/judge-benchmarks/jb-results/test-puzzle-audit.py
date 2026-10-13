"""Exhaustive, label-blind position constraints for all supplied line puzzles."""
import itertools, json, re
from pathlib import Path
root=Path('examples/judge-benchmarks/jb-results')
items=json.loads((root/'final-test-blind-audit.json').read_text())
# Target fields are transcribed from each question, never from a label or a judge.
targets={142:('Hobby',4),151:('position','blueberry'),154:('Job','snowmobile'),164:('Movie-Genre','dubstep'),166:('Music-Genre',3),167:('Music-Genre','french'),169:('position','mirinda'),172:('position','skateboarding'),173:('Movie-Genre','mechanic'),175:('position','pumpkin'),177:('position','avocado'),182:('Food',1),183:('Pet','camping'),184:('Music-Genre','rat'),189:('position','martial-arts movies'),192:('Nationality','rock'),196:('Sport',3),197:('Nationality',2)}
rows=[]
for index,item in enumerate(items):
 q=item['question']
 if not re.match(r'There are \d+ people standing',q): continue
 n=int(re.search(r'There are (\d+) people',q)[1])
 groups={name:values.split(', ') for name,values in re.findall(r'^- ([\w-]+): (.+)$',q,re.M)}
 values=[v for vs in groups.values() for v in vs]
 assert len(values)==len(set(values))
 def identifiers(text):
  found=[(m.start(),m.end(),v) for v in sorted(values,key=len,reverse=True) for m in re.finditer(r'(?<![\w&-])'+re.escape(v)+r'(?![\w&-])',text)]
  kept=[]
  for a,b,v in sorted(found,key=lambda f:-(f[1]-f[0])):
   if not any(a<b1 and b>a1 for a1,b1,_ in kept): kept.append((a,b,v))
  return [v for _,_,v in sorted(kept)]
 def atomic(text):
  ids=identifiers(text)
  if 'between' in text:
   assert len(ids)==3,text
   a,b,c=ids
   if 'immediately between' in text:return lambda p: abs(p[a]-p[b])==1 and abs(p[a]-p[c])==1 and p[b]!=p[c]
   return lambda p:min(p[b],p[c])<p[a]<max(p[b],p[c])
  if 'parity positions' in text:
   assert len(ids)==2,text
   a,b=ids; same='same parity' in text
   return lambda p: ((p[a]-p[b])%2==0)==same
  if 'immediate left or immediate right' in text:
   a,b=ids;return lambda p:abs(p[a]-p[b])==1
  if 'immediate left' in text:
   a,b=ids;return lambda p:p[a]+1==p[b]
  if 'immediate right' in text:
   a,b=ids;return lambda p:p[a]==p[b]+1
  if 'not anywhere to the left' in text:
   a,b=ids;return lambda p:p[a]>=p[b]
  if 'not anywhere to the right' in text:
   a,b=ids;return lambda p:p[a]<=p[b]
  if 'somewhere to the left' in text:
   a,b=ids;return lambda p:p[a]<p[b]
  if 'somewhere to the right' in text:
   a,b=ids;return lambda p:p[a]>p[b]
  if 'far left or far right' in text:
   a,=ids;return lambda p:p[a] in (1,n)
  if 'on the far left' in text:
   a,=ids;return lambda p:p[a]==1
  if 'on the far right' in text:
   a,=ids;return lambda p:p[a]==n
  if 'even position' in text:
   a,=ids;return lambda p:p[a]%2==0
  if 'odd position' in text:
   a,=ids;return lambda p:p[a]%2==1
  if 'in the middle' in text:
   a,=ids;return lambda p:p[a]==(n+1)//2
  assert len(ids)==2,text
  a,b=ids;negative=any(w in text for w in [' is not ',"doesn't eat",'does not own','cannot stand','avoids getting on'])
  return lambda p:(p[a]!=p[b]) if negative else (p[a]==p[b])
 constraints=q.split('Given the following premises about the line of people:')[1].split('Answer the following question:')[0]
 statements=re.findall(r'^- (.+)$',constraints,re.M)
 checks=[]
 for statement in statements:
  if ' or the person' in statement:
   xor=statement.endswith(', but not both'); text=re.sub(r', but not both$| or both$','',statement)
   first,second=re.split(r' or (?=the person)',text,maxsplit=1); a,b=atomic(first),atomic(second)
   checks.append((lambda p,a=a,b=b,xor=xor: (a(p)!=b(p)) if xor else (a(p) or b(p))))
  else: checks.append(atomic(statement))
 field,target=targets[index];assert field=='position' or field in groups
 solutions=[];answers=set()
 for permutations in itertools.product(*(itertools.permutations(range(1,n+1)) for _ in groups)):
  p={v:position for vs,perm in zip(groups.values(),permutations) for v,position in zip(vs,perm)}
  if not all(check(p) for check in checks):continue
  solutions.append(p)
  position=target if isinstance(target,int) else p[target]
  answer=str(position) if field=='position' else next(v for v in groups[field] if p[v]==position)
  answers.add(answer)
 assert solutions,'No solutions: '+str(index)
 rows.append({'index':index,'id':item['id'],'constraints':statements,'target':[field,target],
              'solutions':len(solutions),'possible_answers':sorted(answers),'example':solutions[0]})
(root/'test-puzzle-audit.json').write_text(json.dumps(rows,indent=2)+'\n')
print(json.dumps([{k:r[k] for k in ['index','id','solutions','possible_answers']} for r in rows],indent=2))
