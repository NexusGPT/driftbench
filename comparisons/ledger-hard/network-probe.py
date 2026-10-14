"""Unbilled provider reachability probes; never sends an inference request."""
import argparse,time,urllib.error,urllib.request
from common import *

def probe(cell):
    started=time.monotonic();headers={};status=None;error=None
    if cell=='gpt-6.1-sol':
        url='https://api.openai.com/v1/models'
        headers['Authorization']='Bearer '+(Path.home()/'.nexus-secrets/openai.key').read_text().strip()
    else:
        url='https://api.anthropic.com/v1/models';headers['anthropic-version']='2023-06-01'
    try:
        request=urllib.request.Request(url,headers=headers)
        with urllib.request.urlopen(request,timeout=20) as response:status=response.status;response.read()
    except urllib.error.HTTPError as exc:
        status=exc.code;exc.read()
    except Exception as exc:error={'type':type(exc).__name__,'message':str(exc)}
    healthy=status==200 if cell=='gpt-6.1-sol' else status==401
    return {'stamp':stamp(),'cell':cell,'url':url,'healthy':healthy,'status':status,'elapsed_seconds':time.monotonic()-started,'error':error,'paid':False,'interpretation':'Authenticated model-list receipt' if cell=='gpt-6.1-sol' else 'Expected unauthenticated 401 proves TLS and provider API reachability, not inference readiness'}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('cell',choices=['gpt-6.1-sol','sonnet-5-5']);a=p.parse_args();print(json.dumps(probe(a.cell)))
