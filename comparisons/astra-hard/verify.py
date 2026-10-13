"""Audit the complete one-shot run without model calls or changes to frozen files."""
import collections
import datetime
import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def main():
    freeze = json.loads((HERE / 'preregistration.json').read_text())
    for name, digest in freeze['sha256'].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest, name
    calls = [json.loads(x) for x in (HERE / 'calls.jsonl').read_text().splitlines()]
    starts = [json.loads(x) for x in (HERE / 'starts.jsonl').read_text().splitlines()]
    assert len(calls) == len(starts) == 768
    assert len({r['request_sha256'] for r in calls}) == 768
    assert {r['request_sha256'] for r in calls} == {r['request_sha256'] for r in starts}
    assert all(r['success'] and r['cost_known'] for r in calls)
    assert collections.Counter((r['row'], r['side']) for r in calls) == {
        (row, side): 192 for row in ['promptfoo-rubric', 'langfuse-reference'] for side in ['ours', 'peer']}
    commits = {r['preregistration_commit'] for r in calls}
    assert len(commits) == 1
    commit = next(iter(commits))
    commit_time = datetime.datetime.fromisoformat(subprocess.check_output(
        ['git', 'show', '-s', '--format=%cI', commit], cwd=ROOT, text=True).strip())
    first_call = min(datetime.datetime.fromisoformat(r['started']) for r in calls)
    last_call = max(datetime.datetime.fromisoformat(r['finished']) for r in calls)
    assert commit_time < first_call
    assert last_call < datetime.datetime.fromisoformat(freeze['deadline'])
    # Intervals use dispatch-worker start and completed-envelope time.
    # These contain the subprocess lifetime, so their maximum is an upper bound.
    events = sorted([(r['started'], 1) for r in calls] + [(r['finished'], -1) for r in calls])
    current = maximum = 0
    for _, delta in events:
        current += delta
        maximum = max(maximum, current)
    assert current == 0 and maximum <= 2
    models = sorted({m for r in calls for m in r['model_usage']})
    assert len(models) == 1
    cost = sum(r['cost_usd'] for r in calls)
    assert cost < 10 and all(r['cost_usd'] <= 0.03 for r in calls)
    untouched = subprocess.check_output(['git', 'diff', '--name-only', freeze['source_commit'], '--',
        'packages', 'comparisons/promptfoo/hard', 'comparisons/langfuse/hard'], cwd=ROOT, text=True)
    assert not untouched.strip()
    result = {'verified_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'preregistration_commit': commit, 'preregistration_committed_at': commit_time.isoformat(),
        'first_call': first_call.isoformat(), 'last_call': last_call.isoformat(),
        'unique_calls': len(calls), 'max_concurrent_calls_upper_bound': maximum,
        'frozen_files_verified': len(freeze['sha256']), 'resolved_models': models,
        'unknown_costs': 0, 'failed_calls': 0, 'retries': 0, 'total_cost_usd': cost,
        'old_cases_and_production_unchanged': True}
    (HERE / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
