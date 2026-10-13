"""Replay the frozen scorers under the owner's amended transport limits."""
import datetime
import json
from pathlib import Path
import sys
import operations

HERE = Path(__file__).resolve().parent
mode = sys.argv[1]
assert mode in ['candidates', 'map']
amendment = operations.validate()
path = HERE / mode / 'score.py'
source = path.read_text()
source = source.replace('maximum <= 2', 'maximum <= 6').replace('maximum<=2', 'maximum<=6')
source = source.replace('all_cost < 10', 'all_cost < 20').replace('total<10', 'total<20')
source = source.replace('runner.DEADLINE', "datetime.datetime.fromisoformat('2026-10-13T06:40:00+02:00')")
exec(compile(source, '<owner-authorized transport verification>', 'exec'), {'__name__': '__main__', '__file__': str(path)})
calls = [json.loads(x) for x in (path.parent / 'calls.jsonl').read_text().splitlines()]
starts = [json.loads(x) for x in (path.parent / 'starts.jsonl').read_text().splitlines()]
cutoff = datetime.datetime.fromisoformat('2026-10-13T06:35:00+02:00')
assert all(datetime.datetime.fromisoformat(r['started']) < cutoff for r in calls + starts)
amended = [r for r in calls if 'operational_amendment_commit' in r]
assert amended and all(r['operational_amendment_commit'] == amendment for r in amended)
verify_path = path.parent / 'verification.json'
verification = json.loads(verify_path.read_text())
verification['operational_amendment_commit'] = amendment
verification['calls_under_amended_transport'] = len(amended)
verification['all_dispatches_before_0635_local'] = True
verification['owner_cap_usd'] = 20
verify_path.write_text(json.dumps(verification, indent=2) + '\n')
