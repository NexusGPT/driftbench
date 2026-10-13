"""Close the SortedList audit dependency gap without changing the locked audit or judge."""
import ast
import hashlib
import itertools
import json
import os
import random
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent
item = json.loads((root / 'final-test-blind-audit.json').read_text())[214]
deps = root / 'runtime/sorted-deps'
assert (deps / 'sortedcontainers/__init__.py').exists()
audit_sha = hashlib.sha256((root / 'test-label-audit.json').read_bytes()).hexdigest()
assert audit_sha == '770d7ec6c639cb6a2dcf2c91f66f2821eae72d1f6038f42de6036108ebbb9342'

def oracle(nums, distance):
    return min(abs(a - b) for i, a in enumerate(nums) for j, b in enumerate(nums)
               if abs(i - j) >= distance)

cases = [([4, 3, 2, 4], 2), ([5, 3, 2, 10, 15], 1), ([1, 2, 3, 4], 3)]
for n in range(1, 6):
    for values in itertools.product(range(1, 4), repeat=n):
        cases.extend((list(values), distance) for distance in range(n))
rng = random.Random(20261013)
for _ in range(1000):
    n = rng.randrange(1, 81)
    cases.append(([rng.randrange(1, 10**9 + 1) for _ in range(n)], rng.randrange(n)))
fixtures = [{'nums': nums, 'distance': distance, 'expected': oracle(nums, distance)}
            for nums, distance in cases]
assert len(fixtures) == 2644
rows = []
for side in ['a', 'b']:
    original = item[side]
    tree = ast.parse(original)
    assert all(n.module in {'typing', 'sortedcontainers'} for n in ast.walk(tree)
               if isinstance(n, ast.ImportFrom))
    assert all(a.name == 'bisect' for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names)
    with tempfile.TemporaryDirectory(dir=root / 'runtime', prefix='dependency-proof-') as folder:
        folder = Path(folder).resolve()
        fixture_file = folder / 'cases.json'
        fixture_file.write_text(json.dumps(fixtures))
        wrapper = f'import sys\nsys.path.insert(0, {str(deps)!r})\n' + original
        wrapper += f'''
import json, time
cases = json.load(open({str(fixture_file)!r}))
solution = Solution()
failures = []
for case in cases:
    actual = solution.minAbsoluteDifference(case['nums'], case['distance'])
    if actual != case['expected']:
        failures.append({{'case': case, 'actual': actual}})
print(json.dumps({{'phase': 'small', 'checked': len(cases), 'failures': failures}}), flush=True)
for nums, distance, expected in [(list(range(100000, 0, -1)), 1, 1), ([1000000000] * 100000, 0, 0)]:
    started = time.perf_counter()
    actual = solution.minAbsoluteDifference(nums, distance)
    print(json.dumps({{'phase': 'boundary', 'n': len(nums), 'distance': distance,
                      'expected': expected, 'actual': actual, 'seconds': time.perf_counter()-started}}), flush=True)
'''
        script = folder / 'proof.py'
        script.write_text(wrapper)
        profile = ('(version 1)(allow default)(deny file-write*)(deny network*)(deny process-fork)'
                   '(deny file-read* (subpath "/Users") (subpath "/private/tmp"))'
                   f'(allow file-read* (subpath {json.dumps(str(folder))}) (subpath {json.dumps(str(deps))}))')
        try:
            ran = subprocess.run(['/usr/bin/sandbox-exec', '-p', profile, 'python3', '-I', '-B', str(script)],
                                 cwd=folder, capture_output=True, text=True, timeout=5, check=False)
            observations = [json.loads(line) for line in ran.stdout.splitlines()]
            error = ran.stderr if ran.returncode else None
        except subprocess.TimeoutExpired as exc:
            partial = exc.stdout.decode() if isinstance(exc.stdout, bytes) else exc.stdout or ''
            observations = [json.loads(line) for line in partial.splitlines()]
            error = 'Five-second audit timeout; this is not the benchmark time limit.'
        rows.append({'side': side, 'originalProgramSha256': hashlib.sha256(original.encode()).hexdigest(),
                     'originalBodyUnchanged': True, 'observations': observations, 'error': error})
assert hashlib.sha256((root / 'test-label-audit.json').read_bytes()).hexdigest() == audit_sha
result = {'stamp': datetime.now(timezone.utc).isoformat(), 'id': item['id'], 'index': 214,
          'dependency': 'sortedcontainers==2.4.0', 'dependencySource': 'https://pypi.org/project/sortedcontainers/',
          'afterTonightScoreRead': True, 'lockedAuditSha256': audit_sha,
          'noLabelOrJudgeChanges': True, 'smallCases': len(fixtures),
          'boundaryScope': 'Two valid 100000-element cases on this host; no benchmark-runtime guarantee.',
          'rows': rows}
(root / 'test-code-dependency-audit.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
