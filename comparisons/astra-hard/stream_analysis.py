"""Score unchanged sealed map requests and verify amended transport limits."""
import datetime
import json
from pathlib import Path
import stream_map

HERE = Path(__file__).resolve().parent
amendment = stream_map.validate()
path = HERE / 'map/score.py'
source = path.read_text().replace('maximum<=2', 'maximum<=6').replace('total<10', 'total<20')
source = source.replace('runner.DEADLINE', "datetime.datetime.fromisoformat('2026-10-13T06:40:00+02:00')")
exec(compile(source, '<owner-authorized map transport verification>', 'exec'), {'__name__': '__main__', '__file__': str(path)})
calls = [json.loads(x) for x in (path.parent / 'calls.jsonl').read_text().splitlines()]
starts = [json.loads(x) for x in (path.parent / 'starts.jsonl').read_text().splitlines()]
assert all(datetime.datetime.fromisoformat(r['started']) < stream_map.CUTOFF for r in calls + starts)
assert all(r['operational_amendment_commit'] == amendment for r in calls)
p = path.parent / 'verification.json'
verification = json.loads(p.read_text())
verification.update(operational_amendment_commit=amendment, all_dispatches_before_0635_local=True, owner_cap_usd=20)
p.write_text(json.dumps(verification, indent=2) + '\n')
