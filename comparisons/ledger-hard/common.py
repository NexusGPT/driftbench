"""Shared frozen input and procedure bindings. No network work on import."""
import datetime, hashlib, importlib.util, json, sys
from pathlib import Path
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
HARD = ROOT / 'comparisons/promptfoo/hard'
ROWS = ('rubric', 'factuality', 'pii', 'goal')
MODELS = ('haiku', 'gpt-6-luna')

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

native = load_module('frozen_hard_runner', HARD / 'run.py')
generator = load_module('frozen_hard_generator', HARD / 'generate.py')

def canonical(obj):
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(',', ':'))

def sha(obj):
    return hashlib.sha256(canonical(obj).encode()).hexdigest()

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def cases(row):
    return json.loads((HERE / f'{row}.json').read_text())

def sides(row):
    return ('audit', 'peer', 'peer-full-state') if row == 'goal' else ('audit', 'peer')

def prompt(case, row, side):
    return native.render_audit(case, row) if side == 'audit' else native.render_peer(case, row, side == 'peer-full-state')

def payload(case, row):
    return prompt(case, row, 'audit')

def records():
    path = HERE / 'calls.jsonl'
    original = [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []
    retry_path = HERE / 'retry-results.jsonl'
    retries = [json.loads(line) for line in retry_path.read_text().splitlines() if line.strip()] if retry_path.exists() else []
    by_key = {r['request_sha256']: r for r in original}
    for retry in retries:
        by_key[retry['request_sha256']] = retry
    return list(by_key.values())
