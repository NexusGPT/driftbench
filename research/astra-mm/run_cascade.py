"""Resumable, label-blind escalation calls. No completed request is repeated."""
import concurrent.futures, datetime, hashlib, json, os, pathlib, sys, threading, time, urllib.request, urllib.error
ROOT=pathlib.Path(__file__).resolve().parent
DATA=ROOT/'data'
LOCK=threading.Lock()
LEDGER=pathlib.Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/spend-ledger.md')
PREFIX=sys.argv[1] if len(sys.argv)>1 else 'dev'
WORKERS=int(sys.argv[2]) if len(sys.argv)>2 else 6
GEMINI_ONLY='--gemini-only' in sys.argv
NON_GEMINI='--non-gemini' in sys.argv
assert not (GEMINI_ONLY and NON_GEMINI)
PHASE='gemini-billing-resume-20261013' if GEMINI_ONLY else 'available-panels'
TIMEOUT=180 if GEMINI_ONLY else 300
TASKS=DATA/('tasks.jsonl' if PREFIX=='dev' else f'{PREFIX}-tasks.jsonl')
BASE=DATA/('base.jsonl' if PREFIX=='dev' else f'{PREFIX}-base.jsonl')
OUT=DATA/f'{PREFIX}-calls.jsonl'
ATTEMPTS=DATA/f'{PREFIX}-attempts.jsonl'
KEYDIR=pathlib.Path.home()/'.nexus-secrets'
keys={p:(KEYDIR/f).read_text().strip() for p,f in [('openai','openai.key'),('gemini','gemini-driftbench.key'),('gateway','nexus-orga.key'),('direct','jev-typesafe.key')]}
def rows(path):
 if not path.exists(): return []
 result=[]
 for line in path.read_text().splitlines():
  if line.strip():
   try: result.append(json.loads(line))
   except json.JSONDecodeError: pass # concurrent trailing partial write only
 return result
def append(path,row):
 with open(path,'a') as f:
  f.write(json.dumps(row,ensure_ascii=False)+'\n');f.flush();os.fsync(f.fileno())
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def redact(text):
 for v in keys.values(): text=text.replace(v,'[redacted]')
 return text[:1000]
def cost(provider,payload):
 u=payload.get('usage',payload.get('usageMetadata',{}))
 if provider=='openai':
  i=u.get('prompt_tokens',0);o=u.get('completion_tokens',0);c=u.get('prompt_tokens_details',{}).get('cached_tokens',0)
  return ((i-c)*.10+c*.01+o*.50)/1e6,i,o,c
 if provider=='gemini':
  i=u.get('promptTokenCount',0);o=u.get('candidatesTokenCount',0)+u.get('thoughtsTokenCount',0);c=u.get('cachedContentTokenCount',0)
  return ((i-c)*.75+c*.075+o*3.75)/1e6,i,o,c
 return 0,u.get('input_tokens',0),u.get('output_tokens',0),0
cache={r['key']:r for r in rows(OUT)}
def all_spent():
 return sum(r.get('usd',0) for p in DATA.glob('*-calls.jsonl') for r in rows(p))+sum(r.get('costUsd',0) for p in [DATA/'haiku.jsonl',*DATA.glob('*-haiku.jsonl'),*DATA.glob('*-refusals.jsonl')] for r in rows(p))
spent=all_spent() # includes replayed historical base cost, conservatively
reserved=0.0
inflight=set()
stop=False
retry_after={}
attempt_counts={}
if GEMINI_ONLY:
 for a in rows(ATTEMPTS):
  if a.get('phase')==PHASE and a['event']=='started':attempt_counts[a['key']]=attempt_counts.get(a['key'],0)+1
def post(url,headers,body):
 req=urllib.request.Request(url,json.dumps(body).encode(),{'Content-Type':'application/json',**headers},method='POST')
 with urllib.request.urlopen(req,timeout=TIMEOUT) as response:
  return json.loads(response.read()),response.status

def call(t):
 global spent,reserved,stop
 with LOCK:
  if t['key'] in cache or t['key'] in inflight:return
  if GEMINI_ONLY and (t['provider']!='gemini' or attempt_counts.get(t['key'],0)>=2):return
  if t['provider']=='gemini' and (ROOT/'pause-gemini').exists():return
  spent=all_spent()
  if spent+reserved+1.00>=30:
   stop=True;print('BUDGET_STOP',flush=True);return
  reserved+=.20
  inflight.add(t['key'])
  attempt_counts[t['key']]=attempt_counts.get(t['key'],0)+1
  append(ATTEMPTS,{'time':now(),'key':t['key'],'id':t['id'],'provider':t['provider'],'event':'started','phase':PHASE,'attempt':attempt_counts[t['key']],'timeoutSeconds':TIMEOUT})
 started=time.monotonic();p=t['provider'];route=p
 try:
  if p=='openai':payload,status=post('https://api.openai.com/v1/chat/completions',{'Authorization':'Bearer '+keys[p]},t['body'])
  elif p=='gemini':payload,status=post('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',{'x-goog-api-key':keys[p]},t['body'])
  else:
   try:
    route='gateway';payload,status=post('https://jev-gateway.nexus-orga.gpt.nexus/v1/systemone',{'api-key':keys['gateway']},t['body'])
   except Exception as e:
    with LOCK:append(ATTEMPTS,{'time':now(),'key':t['key'],'id':t['id'],'provider':p,'event':'gateway-failed','error':redact(str(e))})
    route='direct';payload,status=post('https://api.typesafe.ai/v1/systemone',{'Authorization':'Bearer '+keys['direct']},t['body'])
  usd,i,o,c=cost(p,payload)
  result={'key':t['key'],'id':t['id'],'provider':p,'model':t['model'],'order':t['order'],'time':now(),'seconds':time.monotonic()-started,'route':route,'status':status,'payload':payload,'usd':usd,'inputTokens':i,'outputTokens':o,'cachedInputTokens':c}
  with LOCK:
   append(OUT,result);cache[t['key']]=result;spent+=usd
   with open(LEDGER,'a') as f:
    amount=f'{usd:.8f} USD' if p!='jev' else f'{i} input / {o} output tokens, price not published'
    f.write(f"| {now()} | astra-mm {PREFIX} | {t['model']} | item {t['id']} order {t['order']}, {route} | 1 call | {amount} |\n")
   if len(cache)%10==0:print(json.dumps({'completed':len(cache),'spendConservative':round(spent,6),'lastProvider':p}),flush=True)
 except Exception as e:
  err=redact(str(e))
  if isinstance(e,urllib.error.HTTPError):
   err+= ' '+redact(e.read().decode(errors='replace'))
  with LOCK:
   append(ATTEMPTS,{'time':now(),'key':t['key'],'id':t['id'],'provider':p,'event':'failed','error':err})
   retry_after[t['key']]=time.time()+60
  print(json.dumps({'provider':p,'id':t['id'],'error':err}),flush=True)
 finally:
  with LOCK:
   reserved-=.20
   inflight.discard(t['key'])

if not TASKS.exists():raise SystemExit('Task bank missing; generate it before starting calls')
alltasks=rows(TASKS)
expected=len({t['id'] for t in alltasks})
with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
 while not stop:
  cache.update({r['key']:r for r in rows(OUT)})
  bases={r['id']:r for r in rows(BASE)}
  escalated={i for i,r in bases.items() if r.get('providerRefused') or not(len(r['games'])==2 and r['games'][0]==r['games'][1] and r['games'][0] in ('A','B'))}
  pending=[t for t in alltasks if t['id'] in escalated and t['key'] not in cache]
  ready=[t for t in pending if retry_after.get(t['key'],0)<=time.time() and not(t['provider']=='gemini' and (ROOT/'pause-gemini').exists()) and (not NON_GEMINI or t['provider']!='gemini') and (not GEMINI_ONLY or (t['provider']=='gemini' and attempt_counts.get(t['key'],0)<2))]
  waiting=sorted({t['id'] for t in pending if t['provider']=='gemini'},key=int)
  (DATA/f'{PREFIX}-waiting-gemini.json').write_text(json.dumps({'items':waiting,'n':len(waiting),'pendingCalls':sum(t['provider']=='gemini' for t in pending)},indent=2)+'\n')
  if ready:
   print(json.dumps({'time':now(),'baseItems':len(bases),'escalated':len(escalated),'pending':len(pending),'workers':WORKERS}),flush=True)
   list(pool.map(call,ready))
  elif len(bases)==expected and (not pending or (('--available' in sys.argv or NON_GEMINI) and not any(t['provider']!='gemini' for t in pending)) or (GEMINI_ONLY and not any(t['provider']=='gemini' for t in pending))):
   print(json.dumps({'done':True,'geminiPaused':(ROOT/'pause-gemini').exists(),'waitingGeminiItems':len(waiting),'waitingGeminiCalls':sum(t['provider']=='gemini' for t in pending),'items':expected,'escalated':len(escalated),'calls':len(cache),'spendConservative':spent}),flush=True);break
  elif GEMINI_ONLY and len(bases)==expected and any(t['provider']=='gemini' for t in pending) and all(attempt_counts.get(t['key'],0)>=2 for t in pending if t['provider']=='gemini'):
   print(json.dumps({'stopped':'Gemini one-retry limit reached','pending':len(pending)}),flush=True);break
  else:time.sleep(10)
