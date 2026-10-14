"""Parity: one peer on the first 30 dev pairs through the Messages API, with its own fresh journal.

  python examples/judgebench-fresh/parity/parity_peers.py deepeval OUT.jsonl JOURNAL.jsonl
"""
import json, sys, os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
R = str(Path(__file__).resolve().parents[2])
sys.path[:0] = [R + '/all-peers-public', R + '/judgebench-fresh']
os.environ.setdefault('DEEPEVAL_TELEMETRY_OPT_OUT', 'YES')
from run import run_job
from transport import Journal
from api_transport import run_api
from run_peers import items_for
peer, out, journal_path = sys.argv[1:4]
items = items_for('dev')[:30]
j = Journal(journal_path, 2.0, run_claude=run_api)
def one(ix):
    item = items[ix]
    row = run_job('judgebench', peer, ix, item, lambda s, u: j.call(peer, 'parity', s, u))
    return {'id': item['id'], 'games': row.get('games')}
with ThreadPoolExecutor(8) as pool:
    rows = list(pool.map(one, range(len(items))))
with open(out, 'w') as h:
    for r in rows: h.write(json.dumps(r) + '\n')
print(peer, 'cost', round(j.known_usd, 4))
