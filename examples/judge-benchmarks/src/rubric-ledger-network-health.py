import datetime,json,sys,time,urllib.request,urllib.error
from pathlib import Path
provider=sys.argv[1];model=sys.argv[2];cache=Path('.cache/ledger-rb');state=cache/(provider+'-network-health.json');journal=cache/(provider+'-network-health.jsonl')
url={'anthropic':'https://api.anthropic.com/v1/models','openai':'https://api.openai.com/v1/models/gpt-6.1-sol'}[provider]
headers={}
if provider=='openai':headers['Authorization']='Bearer '+(Path.home()/'.nexus-secrets/openai.key').read_text().strip()
good=bad=0
while good<10:
 started=time.monotonic();stamp=datetime.datetime.now(datetime.timezone.utc).isoformat();status=None;error=None
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=15) as response:status=response.status
 except urllib.error.HTTPError as e:status=e.code
 except Exception as e:error=type(e).__name__+': '+str(e)
 healthy=status==200 if provider=='openai' else status in [200,401,403,404]
 if healthy:good+=1;bad=0
 else:good=0;bad=bad+1 if error else 0
 row={'at':stamp,'provider':provider,'model':model,'url':url,'status':status,'connectionError':error,'healthy':healthy,'consecutiveHealthy':good,'consecutiveConnectionFailures':bad,'durationSeconds':time.monotonic()-started,'paid':False,'probeKind':'Authenticated model metadata' if provider=='openai' else 'Unauthenticated model-list endpoint; expected auth rejection proves HTTPS connectivity, not generation quality','ready':good>=10,'paidConcurrency':2}
 with journal.open('a') as f:f.write(json.dumps(row)+'\n')
 state.write_text(json.dumps(row,indent=2)+'\n')
 if good>=10:break
 if bad>=3:time.sleep(600);bad=0
 else:time.sleep(max(0,30-(time.monotonic()-started)))
