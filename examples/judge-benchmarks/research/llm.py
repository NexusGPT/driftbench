"""Recorded claude -p calls (haiku), same flags as the harness. Replay is free; at most 2 calls at once."""
import hashlib, json, os, subprocess, threading

HERE = os.path.dirname(os.path.abspath(__file__))
REC = os.path.join(HERE, 'recordings.jsonl')
_lock = threading.Lock()
_cache = {}
if os.path.exists(REC):
    for line in open(REC):
        try:
            e = json.loads(line)
            _cache[e['key']] = e
        except Exception as err:  # a torn last line is skipped, never silently trusted
            print('skip recording line:', err)


def key(system, user, model='haiku'):
    return hashlib.sha256(json.dumps([model, system, user]).encode()).hexdigest()[:24]


def call(system, user, label, model='haiku', timeout=300):
    k = key(system, user, model)
    if k in _cache:
        return _cache[k]['text'], 0.0, True
    args = ['claude', '-p', '--output-format', 'json', '--model', model, '--system-prompt', system,
            '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
            '--max-turns', '1']
    for attempt in range(2):
        try:
            r = subprocess.run(args, input=user, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            continue
        try:
            p = json.loads(r.stdout)
        except Exception:
            print('bad output', r.stderr[:300])
            continue
        if p.get('is_error'):
            print('error', str(p.get('result'))[:200])
            continue
        e = {'key': k, 'label': label, 'text': p.get('result', ''), 'cost': p.get('total_cost_usd', 0)}
        with _lock:
            _cache[k] = e
            with open(REC, 'a') as f:
                f.write(json.dumps(e) + '\n')
        return e['text'], e['cost'], False
    return None, 0.0, False


def cost_of(system, user, model='haiku'):
    e = _cache.get(key(system, user, model))
    return e['cost'] if e else 0.0
