import json,re,sys
tag=sys.argv[1]
split=open('/Users/assem/driftbench-lanes/pointer-chain/repo/research/condition-label/SPLIT.md').read()
dev=set(re.findall(r"^\* `(.*?)`",split.split('## Held-out')[0],re.M)); held=set(re.findall(r"^\* `(.*?)`",split.split('## Held-out')[1],re.M))
out=open(f'out_{tag}.txt').read()
ref=re.findall(r"^\s+refused: (.*?)(?:#\d+| unit \w+ \(\w+\)): (.*)$",out,re.M)
c={'dev':{},'held':{}}
for f,why in ref:
    side='dev' if f in dev else 'held' if f in held else 'other'
    if side=='other': print('other',f); continue
    k=re.sub(r'unit .*?\)','',why)[:60]; c[side][k]=c[side].get(k,0)+1
u=[0,0]; n=0
for l in open(f'e_{tag}/c.jsonl'):
    r=json.loads(l); us=r['answer'].get('usage',{}); u[0]+=us.get('input',0); u[1]+=us.get('output',0); n+=1
usd=(u[0]*0.10+u[1]*0.50)/1e6
m=re.search(r'Requests: (.*)',out)
print(tag,'dev',sum(c['dev'].values()),'held',sum(c['held'].values()),'| requests',m.group(1) if m else '?','| usd',round(usd,4))
for s in c: print('  ',s,c[s])
