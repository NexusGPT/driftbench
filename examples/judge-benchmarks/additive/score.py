"""DEV-only additive scorer. No networking. Every decision rule preregistered in git."""
import json, re, hashlib
from pathlib import Path
from collections import Counter
H=Path(__file__).resolve().parent
RESULTS=H.parent/'results'
def read(p): return json.loads(p.read_text())
def save(name,d): (H/name).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def parse(s):
 try: return json.loads(s[s.index('{'):s.rindex('}')+1])
 except (ValueError,json.JSONDecodeError): return {}
base=read(H/'driftbench-verify-uncertainty-cascade.json')['contestants'][0]
bas={r['id']:r['pass'] for r in base['decisions']}
blk={r['id']:r for r in read(RESULTS/'blocks-verify-dev.json')['results']}
rec={r['id']:r for r in read(RESULTS/'blocks-verify-recovery-dev.json')['results']}
audit={r['id']:r['audited'] for r in read(H/'label-audit.json')}
items={r['id']:r for r in read(H/'verify-dev-items.json')}
assert len(bas)==len(blk)==len(rec)==len(items)==95 and bas.keys()==blk.keys()==rec.keys()==items.keys()
assert all(hashlib.sha256(f'split:longjudge-verify:{i}'.encode()).digest()[0]<77 for i in items)
raw={}
for l in (H.parent/'recordings/longjudge-verify/haiku-blocks.jsonl').open():
 r=json.loads(l); k=(r['item'],r['order']); assert k not in raw;raw[k]=r
solfile=read(H/'solver-dev.json')
sol={}
for r in solfile['rows']:
 if r['solver'][0]==r['solver'][1] and r['solver'][0]!='unknown':
  matches=[i for i in items if i.startswith(r['id'])];assert len(matches)==1
  sol[matches[0]]=r['solver'][0]==r['response']
route={i for i in bas if bas[i] and i not in sol}
R={i for i in route if rec[i].get('pass') is False}
A=set()
for i in R:
 first=blk[i]; failed=first['decidedBy'].split(':')[1] if ':' in first['decidedBy'] else None
 judged=parse(raw.get((i,'judge'),{}).get('text',''))
 jfail=any(b.get('id')==failed and b.get('verdict')=='fail' for b in judged.get('blocks',[]))
 recovery=parse(raw.get((i,'recovery'),{}).get('text',''))
 if jfail and ((recovery.get('criticism_right') is True and recovery.get('final_holds') is False) or first.get('machineFail') is True): A.add(i)
gates=read(H/'cascade-gates-dev.json') if (H/'cascade-gates-dev.json').exists() else None
B={r['id'] for r in gates['rows'] if r['uncertainty']} if gates else set()
cross=read(H/'cross-family-dev.json') if (H/'cross-family-dev.json').exists() else None
C={r['id'] for r in cross['rows'] if r.get('confirmed') is True} if cross else set()

def verify_score(name,veto,withsolver=True,bgate=False,confirm=False):
 decisions={i:(sol[i] if withsolver and i in sol else False if i in veto else bas[i]) for i in bas}
 gt={i:audit.get(i,blk[i]['label']) for i in bas}
 fixes=[i for i in bas if decisions[i]==gt[i] and bas[i]!=gt[i]]
 breaks=[i for i in bas if decisions[i]!=gt[i] and bas[i]==gt[i]]
 newfr=[i for i in breaks if gt[i] is True and decisions[i] is False]
 routed=(route&B if bgate else route) if name not in ['cascade','cascade+M4'] else set()
 blockcost=sum(rec[i]['costUsd'] for i in routed)
 solvercost=solfile['cost'] if withsolver else 0
 paid=(R & B if bgate else R) if confirm else set()
 # A can be computed before C, avoiding confirmer calls for candidates A rejects.
 if confirm and 'A' in name: paid &= A
 reasons=Counter('solver:M4' if withsolver and i in sol else 'block-veto:'+name if i in veto else 'cascade' for i in bas)
 return dict(name=name,official=sum(decisions[i]==blk[i]['label'] for i in bas),audited=sum(decisions[i]==gt[i] for i in bas),n=95,fixes=fixes,breaks=breaks,newFalseRejections=newfr,decidedBy=dict(reasons),vetoed=sorted(veto),routedBlockItems=len(routed),crossFamilyItems=len(paid),incrementalKnownUsdPer100=100*(blockcost+solvercost)/95,incrementalReservedUsdPer100=100*len(paid)/95,baselineUsdPer100=100*base['costUsd']/95,decisions=decisions,barMet=sum(decisions[i]==gt[i] for i in bas)>=90 and not newfr)
vs=[verify_score('cascade',set(),False),verify_score('cascade+M4',set()),verify_score('R',R),verify_score('A',A)]
if gates:
 vs.extend([verify_score('B',R&B,bgate=True),verify_score('A&B',A&B,bgate=True)])
if cross:
 vs.extend([verify_score('C',R&C,confirm=True),verify_score('A&C',A&C,confirm=True)])
 if gates: vs.extend([verify_score('B&C',R&B&C,bgate=True,confirm=True),verify_score('A&B&C',A&B&C,bgate=True,confirm=True)])
save('cross-inputs-dev.json',[{'id':i,'question':items[i]['question'],'response':items[i]['response']} for i in sorted(R)])
# Frozen writing source uses A/B normalized to the original drafts.
w=read(RESULTS/'blocks-wp-dev.json')['results']; hol={r['rowKey']:r for r in read(H/'writing-holistic-dev.json')['results']}
assert len(w)==len(hol)==90
assert all(r['holistic']==hol[r['rowKey']]['games'] for r in w)
D={k for k,r in hol.items() if r['games'][0]!=r['games'][1]}
L={k for k,r in hol.items() if any(isinstance(p,dict) and isinstance(p.get('confidence'),int) and 1<=p['confidence']<=2 for p in r.get('parsed',[]))}
U=D|L
wa=read(H/'writing-audit-dev.json')
assert not any('audited' in r or 'auditedLabel' in r or 'correctedLabel' in r for r in wa['items'])
ws=[]
for name,gate,mode in [('holistic',set(),'per-order'),('D/order',D,'per-order'),('D/consensus',D,'consensus'),('U/order',U,'per-order'),('U/consensus',U,'consensus'),('U/machine',U,'machine')]:
 fixes=[];breaks=[];rows=[];reason=Counter();correct=inside0=inside1=0
 for r in w:
  k=r['rowKey']; old=hol[k]['games']; new=old[:];why=['holistic']*2
  if k in gate:
   use=r['machineOnly'] if mode=='machine' else r['games']
   if mode!='consensus' or (use[0]==use[1] and use[0] in ['A','B']):
    new=use[:];why=['blocks' if use[j]!=old[j] else 'holistic-or-agreeing-blocks' for j in range(2)]
  for j in range(2):
   ok0=old[j]==r['label'];ok=new[j]==r['label'];correct+=ok;reason[why[j]]+=1
   if k in gate: inside0+=ok0;inside1+=ok
   if ok and not ok0:fixes.append(f'{k}:{j}')
   if ok0 and not ok:breaks.append(f'{k}:{j}')
  rows.append({'rowKey':k,'id':r['id'],'group':r['group'],'label':r['label'],'games':new,'baseline':old,'routed':k in gate})
 # machine needs request compiler only, obtained from the matching writing recording.
 if mode=='machine':
  paircost=Counter()
  for line in (H.parent/'recordings/longjudge-wp/haiku-blocks.jsonl').open():
   z=json.loads(line)
   if z.get('order') in ['AB','BA'] and z.get('contestant')=='driftbench-blocks':paircost[z['item']]+=z['costUsd']
  cost=sum(r['costUsd']-paircost[r['rowKey']] for r in w if r['rowKey'] in gate)
 else: cost=sum(r['costUsd'] for r in w if r['rowKey'] in gate)
 ws.append(dict(name=name,official=correct,audited=None,auditNote='No corrected label map: 19 defensible, 4 suspect, 3 ambiguous in 26 reviewed DEV pairs. No label is silently flipped.',n=180,routedPairs=len(gate),routedGames=2*len(gate),subsetBaselineCorrect=inside0,subsetDesignCorrect=inside1,netGames=inside1-inside0,fixes=fixes,breaks=breaks,newFalseRejections=None,decidedBy=dict(reason),incrementalKnownUsdPer100=100*cost/90,baselineUsdPer100=read(H/'writing-holistic-dev.json')['costPer100'],barMet=correct>=122,rows=rows))
out=dict(preregistrationCommits=['4a1df605','bd9359fd','58d750ee'],verify=vs,writing=ws,routing=dict(R=sorted(R),A=sorted(A),B=sorted(B),C=sorted(C),D=sorted(D),lowConfidence=sorted(L),U=sorted(U)),crossFamily=cross)
save('scores-dev.json',out)
for r in vs:print('VERIFY',r['name'],r['official'],r['audited'],'fix/break/FR',len(r['fixes']),len(r['breaks']),len(r['newFalseRejections']),'extra/100',round(r['incrementalKnownUsdPer100'],4),'reserve/100',round(r['incrementalReservedUsdPer100'],4))
for r in ws:print('WRITING',r['name'],r['official'],'routed',r['routedPairs'],'net',r['netGames'],'fix/break',len(r['fixes']),len(r['breaks']),'extra/100',round(r['incrementalKnownUsdPer100'],4))
print('R touched',[i[:8] for i in sorted(R)])
