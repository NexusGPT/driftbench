"""Repeat only zero-output connection failures, gated and receipted per physical attempt."""
import json,os,re,subprocess,sys,time
from pathlib import Path
BASE=Path(__file__).resolve().parent;ROOT=BASE.parents[1]
CONNECTION=re.compile(r'ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|connect(?:ion)?[^\n]{0,40}(?:timeout|reset|refused|closed)|fetch failed|could not be reached|ran past \d+ ms|socket hang up|DNS',re.I)
def main():
 args=sys.argv[1:];model=args[args.index('--model')+1];folder={'gpt-6.1-sol':'sol61','claude-sonnet-5-5':'sonnet'}[model]
 user=sys.stdin.read();attempt=0
 while True:
  attempt+=1
  ran=subprocess.run([str(ROOT/'node_modules/.bin/tsx'),'--tsconfig',str(BASE/'tsconfig.json'),str(BASE/'new-cell-transport.ts'),*args],input=user,text=True,capture_output=True,cwd=ROOT,check=True)
  if ran.stderr:sys.stderr.write(ran.stderr)
  value=json.loads(ran.stdout)
  if not value.get('is_error') or value.get('verify_answered'):
   sys.stdout.write(json.dumps(value));return
  if not CONNECTION.search(value.get('result','')):
   sys.stdout.write(json.dumps(value));return
  with (BASE/folder/'receipts/network-retries.jsonl').open('a') as f:f.write(json.dumps(dict(at=time.time(),attempt=attempt,model=model,receipt=value.get('verify_receipt_id'),reason=value.get('result'),answerResent=False))+'\n')
  time.sleep(30)
if __name__=='__main__':main()
