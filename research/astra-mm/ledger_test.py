"""Append each measured TEST Haiku receipt once to the owner's spend ledger."""
import datetime,json,pathlib,re,os
R=pathlib.Path(__file__).resolve().parent;D=R/'data'
ledger=pathlib.Path('/private/tmp/claude-501/-Users-assem-Documents-Doc-Assem-Claude-Code-nexus/649588d0-8d65-49cb-8d78-47b071cd71cb/scratchpad/spend-ledger.md')
recorded=set(re.findall(r'astra-mm TEST Haiku key=([0-9a-f]+)',ledger.read_text()))
rows=[]
for name in ['test-haiku.jsonl','test-refusals.jsonl']:
 p=D/name
 if p.exists():
  for line in p.read_text().splitlines():
   if line.strip():rows.append(json.loads(line))
assert len(rows)==len({r['key'] for r in rows}), 'Unexpected duplicate TEST Haiku receipt keys'
fresh=[r for r in rows if r['key'] not in recorded]
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
with open(ledger,'a') as f:
 for r in fresh:
  f.write(f"| {now} | astra-mm TEST Haiku key={r['key']} | haiku | item {r['item']} order {r['order']}, {'provider refusal' if r.get('providerRefused') else 'CLI receipt'} | 1 call | {r['costUsd']:.8f} USD |\n")
 f.flush();os.fsync(f.fileno())
print(json.dumps({'newLedgerRows':len(fresh),'newUsd':sum(r['costUsd'] for r in fresh),'totalTestHaikuReceipts':len(rows),'totalTestHaikuUsd':sum(r['costUsd'] for r in rows)}))
