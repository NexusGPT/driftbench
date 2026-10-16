"""Turn the bench re-record spend ledger into the shared meter's import format, so its charges count against the cap."""
import json, sys
from pathlib import Path

rows = [json.loads(l) for l in Path(sys.argv[1]).read_text().splitlines() if l.strip()]
lines = []
for n, r in enumerate(rows):
    call = f"bench-rerecord-{n:05d}"
    lines.append({'event': 'start', 'call': call, 'reserve': r['chargedUsd']})
    if r['status'] == 'ok' and r['accounting'] != 'reserved-on-error':
        lines.append({'event': 'finish', 'call': call, 'costUsd': r['chargedUsd']})
    else:
        lines.append({'event': 'error', 'call': call, 'reserve': r['chargedUsd']})
Path(sys.argv[2]).write_text(''.join(json.dumps(x) + '\n' for x in lines))
print(json.dumps({'calls': len(rows), 'chargedUsd': round(sum(r['chargedUsd'] for r in rows), 6)}))
