"""Owner-authorized transport amendment; frozen cases and judge procedures stay intact."""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

def validate():
    manifest = json.loads((HERE / 'operations-registration.json').read_text())
    commit = subprocess.check_output(['git', 'log', '-1', '--format=%H', '--', 'comparisons/astra-hard/operations-registration.json'], cwd=ROOT, text=True).strip()
    assert commit
    for name, digest in manifest['sha256'].items():
        actual = (ROOT / name).read_bytes()
        assert hashlib.sha256(actual).hexdigest() == digest
        assert subprocess.check_output(['git', 'show', f'{commit}:{name}'], cwd=ROOT) == actual
    assert subprocess.check_output(['git', 'show', f'{commit}:comparisons/astra-hard/operations-registration.json'], cwd=ROOT) == (HERE / 'operations-registration.json').read_bytes()
    return commit

def main():
    mode = sys.argv.pop(1)
    assert mode in ['candidates', 'map']
    commit = validate()
    path = HERE / mode / 'run.py'
    source = path.read_text()
    changes = {
        'TOTAL_CAP = 10.0': 'TOTAL_CAP = 20.0',
        '2026-10-13T07:30:00+02:00': '2026-10-13T06:35:00+02:00',
        'max_workers=2': 'max_workers=6',
        'range(0, len(pending), 2)': 'range(0, len(pending), 6)',
        'pending[offset:offset + 2]': 'pending[offset:offset + 6]',
        'global concurrency 2': 'global concurrency 6',
        'task cap 10.00': 'task cap 20.00',
        'of 10.00 USD': 'of 20.00 USD',
        "'model_alias': 'haiku'": f"'model_alias': 'haiku', 'operational_amendment_commit': '{commit}'",
    }
    for old, new in changes.items():
        assert old in source, old
        source = source.replace(old, new)
    # A dispatch must precede the cutoff even if a worker starts later than its
    # journal entry. Model settings and the request bytes are unchanged.
    old = '    started = stamp()\n'
    assert old in source
    source = source.replace(old, "    assert datetime.datetime.now(datetime.timezone.utc) < DEADLINE, 'Last-call cutoff reached'\n" + old)
    exec(compile(source, '<owner-authorized transport amendment>', 'exec'), {'__name__': '__main__', '__file__': str(path)})

if __name__ == '__main__':
    main()
