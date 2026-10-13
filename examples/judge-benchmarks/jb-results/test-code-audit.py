"""Execute actual proposal bodies on label-blind counterexamples, with a native sandbox and timeout."""
import ast, hashlib, json, os, subprocess, tempfile, time
from pathlib import Path
root=Path('examples/judge-benchmarks/jb-results');items=json.loads((root/'final-test-blind-audit.json').read_text())
cases={
199:[([1,0,'a'],'YES'),([3,1,'abc'],'NO')],200:[([3],'Second'),([1],'First')],
201:[([[3,-1,-5,2,5,-9]],1350),([[-1]],-1)],202:[(['1','12',1,8],11)],
203:[([[2,3,6]],True),([[3,9,5]],False)],204:[([1,1],-1),([3,-2],3)],
205:[([['aa','ab']],0),([['ab','ba','cc']],1)],206:[([2,5,1],12),([3,2,2],14)],
207:[([[1,3,6,4,1,2],2],3)],208:[([[2,3,4,5],4],3)],209:[([[1,1,1],2],False)],
210:[([[2,1,3]],False)],211:[([[1,1],3],True),([[1],200],True)],
212:[([[1,1,50]],2),([[10]],1)],213:[([4,[[0,1,100],[0,2,1],[3,3,100]]],200)],
214:[([[4,3,2,4],2],0)],215:[([[1,3,5]],0)],216:[([[1,0,2,0,1,2]],3)],
217:[([[0,1]],1)],218:[([[2,4,6,8],3],-1)],219:[(['100'],2)],220:[(['abddez'],2)],
221:[(['aaaa','bbbb',['a','c'],['c','b'],[1,2]],12)],222:[([[2,1]],False)],
223:[([[0],1],1)],224:[([[8,4,2,30,15]],True),([[8,3,1]],False)],
225:[(['aAbBcC'],2)],226:[([[3,2,1,4,5]],2)],227:[([[1,1]],True),([[1,1,1,2,3,4]],False)],
228:[([5,5,['ezzzz','zkzzz','ezuzs','zzznz','zzzzs']],[[4,4],[3,3],[2,2],[1,1],[0,0]])]}
allowed={'typing','math','collections','itertools','functools','bisect','heapq','statistics','fractions','decimal','random','sortedcontainers'}
class Annotations(ast.NodeTransformer):
 def visit_FunctionDef(self,node):
  node.returns=None
  for arg in [*node.args.posonlyargs,*node.args.args,*node.args.kwonlyargs]:arg.annotation=None
  return self.generic_visit(node)
 def visit_AnnAssign(self,node):return ast.copy_location(ast.Assign(targets=[node.target],value=node.value or ast.Constant(None)),node)
rows=[]
for index in range(199,229):
 item=items[index]
 for side in ['a','b']:
  code=item[side]; tree=ast.parse(code)
  kept=[]
  for node in tree.body:
   if isinstance(node,(ast.Import,ast.ImportFrom)):
    modules=[a.name.split('.')[0] for a in node.names] if isinstance(node,ast.Import) else [node.module.split('.')[0]]
    if all(m in allowed for m in modules):kept.append(node)
   elif isinstance(node,ast.ClassDef) or isinstance(node,ast.FunctionDef) and node.name!='main':kept.append(node)
  tree=Annotations().visit(ast.Module(body=kept,type_ignores=[]));ast.fix_missing_locations(tree)
  for node in ast.walk(tree):
   if isinstance(node,ast.Name):assert node.id not in {'open','eval','exec','compile','getattr','setattr','globals','locals','__import__'},node.id
   if isinstance(node,ast.Import):assert all(a.name.split('.')[0] in allowed for a in node.names)
   if isinstance(node,ast.ImportFrom):assert node.module.split('.')[0] in allowed
   if isinstance(node,ast.Attribute):assert node.attr not in {'system','popen','environ','write_text','read_text','unlink'},node.attr
  classes=[n for n in tree.body if isinstance(n,ast.ClassDef)]
  functions=[n for n in tree.body if isinstance(n,ast.FunctionDef)]
  name=next(n.name for n in classes[0].body if isinstance(n,ast.FunctionDef)) if classes else functions[0].name
  call='getattr(Solution(),'+repr(name)+')' if classes else name
  payload=ast.unparse(tree)+'\nimport json,copy,time\n'+f'cases=json.loads({json.dumps(json.dumps(cases[index]))})\n'
  payload+='results=[]\nfor args,expected in cases:\n try:\n  started=time.monotonic()\n  got='+call+'(*copy.deepcopy(args))\n  if isinstance(got,bool) and expected in ("YES","NO"): got="YES" if got else "NO"\n  got=json.loads(json.dumps(got))\n  results.append({"args":args,"expected":expected,"actual":got,"correct":got==expected,"seconds":time.monotonic()-started})\n except Exception as e:\n  results.append({"args":args,"expected":expected,"error":type(e).__name__+": "+str(e),"correct":False})\nprint(json.dumps(results))\n'
  with tempfile.TemporaryDirectory(dir=root/'runtime',prefix='test-code-proof-') as folder:
   f=Path(folder)/'proof.py';f.write_text(payload)
   profile=f'(version 1)(allow default)(deny file-write*)(deny network*)(deny process-fork)(deny file-read* (subpath "/Users") (subpath "/private/tmp"))(allow file-read* (subpath {json.dumps(str(Path(folder).resolve()))}))'
   try:
    result=subprocess.run(['/usr/bin/sandbox-exec','-p',profile,'python3','-I',str(f.resolve())],capture_output=True,text=True,timeout=5,check=False,cwd=folder)
    tests=json.loads(result.stdout) if result.returncode==0 else {'error':result.stderr[-1000:],'exit':result.returncode}
   except subprocess.TimeoutExpired:tests={'error':'Five-second audit sandbox timeout; not a benchmark time-limit assertion.'}
  rows.append({'index':index,'id':item['id'],'side':side,'proposal_sha256':hashlib.sha256(code.encode()).hexdigest(),'entry':name,'tests':tests})
(root/'test-code-audit.json').write_text(json.dumps(rows,indent=2)+'\n')
print(json.dumps([{'index':r['index'],'side':r['side'],'tests':r['tests']} for r in rows],indent=2))
