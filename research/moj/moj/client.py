"""Recorded clients for the MoJ pilot.

Every request and every returned answer is appended to a JSONL recording keyed by the request hash.
A returned answer is never asked again. A call with no answer is submitted at most three times.
Keys are read from a file inside the process and never written, printed or logged.
"""
import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REC = os.path.join(HERE, 'recordings')
JEV_URLS = {
    'gateway': 'https://jev-gateway.nexus-orga.gpt.nexus/v1/systemone',
    'typesafe': 'https://api.typesafe.ai/v1/systemone',
}
JEV_KEYS = {'gateway': '~/.nexus-secrets/nexus-orga.key', 'typesafe': '~/.nexus-secrets/jev-typesafe.key'}
OPENAI_KEY = '~/.nexus-secrets/openai.key'
LUNA_PRICE = {'input': 0.10, 'cached': 0.01, 'output': 0.50}  # USD per 1M tokens
MAX_SUBMISSIONS = 3
WAITS_403 = (20, 60, 180)
MAX_WORKERS = 8  # worker threads of one runner
JEV_PARALLEL = 3  # System-1 calls in flight per runner: several helpers share the gateway
_jev_gate = threading.Semaphore(JEV_PARALLEL)
_lock = threading.Lock()
_cache = {}
_inflight = {}


def _key_lock(key):
    with _lock:
        return _inflight.setdefault(key, threading.Lock())


def _key(path):
    with open(os.path.expanduser(path)) as handle:
        return handle.read().strip()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def compact(value):
    """The stored copy of a request: any string over 400 characters becomes its hash and length.

    The key is the hash of the full request, and the full texts live in data/, so a replay needs no more.
    """
    if isinstance(value, dict):
        return {k: compact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [compact(v) for v in value]
    if isinstance(value, str) and len(value) > 400:
        return {'sha256': hashlib.sha256(value.encode()).hexdigest(), 'chars': len(value), 'head': value[:80]}
    return value


def _load(name):
    if name in _cache:
        return _cache[name]
    rows = {}
    path = os.path.join(REC, name)
    if os.path.exists(path):
        with open(path) as handle:
            for line in handle:
                row = json.loads(line)
                if row.get('answer') is not None:
                    rows.setdefault(row['key'], row)  # the first returned answer is the answer
    _cache[name] = rows
    return rows


def _append(name, row):
    with _lock:
        with open(os.path.join(REC, name), 'a') as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + '\n')
        if row.get('answer') is not None:
            _cache.setdefault(name, {}).setdefault(row['key'], row)


def _post(url, headers, body, timeout):
    data = json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, headers={'content-type': 'application/json', **headers})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode())


def _redact(error):
    text = str(error)
    if isinstance(error, urllib.error.HTTPError):
        try:
            text = f'HTTP {error.code}: {error.read().decode()[:300]}'
        except Exception:
            text = f'HTTP {error.code}'
    return text[:400]


def _recorded_call(name, request, send, offline):
    """Replay a recorded answer, or submit up to three times and record the first answer."""
    key = digest(request)
    with _lock:
        rows = _load(name)
    if key in rows:
        return rows[key]
    with _key_lock(key):  # an identical request in flight is joined, never sent twice
        return _submit(name, key, request, send, offline)


def _submit(name, key, request, send, offline):
    rows = _cache[name]
    if key in rows:
        return rows[key]
    if offline:
        raise RuntimeError(f'recording miss in offline mode: {name} {key[:12]}')
    last = None
    for submission in range(1, MAX_SUBMISSIONS + 1):
        started = time.time()
        try:
            answer = send()
            row = {'key': key, 'request': compact(request), 'answer': answer, 'seconds': round(time.time() - started, 3),
                   'submission': submission}
            _append(name, row)
            return row
        except Exception as error:  # no answer: transport or HTTP error
            last = _redact(error)
            _append(name, {'key': key, 'answer': None, 'error': last, 'submission': submission,
                           'seconds': round(time.time() - started, 3)})
            code = error.code if isinstance(error, urllib.error.HTTPError) else None
            if code in (400, 401, 404, 413, 422):
                break  # the request itself is refused: a second submission would get the same answer
            if submission < MAX_SUBMISSIONS:
                # the gateway answers 403 in bursts when several runners call it: wait 20, 60, 180 s
                time.sleep(WAITS_403[submission - 1] if code in (403, 429) else 2 * submission)
    return {'key': key, 'request': compact(request), 'answer': None, 'error': last}


def jev(state, questions, route='gateway', model='jev-latest', offline=False, timeout=60):
    """questions: {name: {'question': str, 'focus': str?}}. Returns ({name: probability of yes}, row)."""
    body = {'model': model, 'state': state,
            'questions': {name: {'type': 'noul', 'instructions': spec} for name, spec in questions.items()}}
    request = {'client': 'jev', 'route': route, 'body': body}

    def send():
        key = _key(JEV_KEYS[route])
        headers = {'api-key': key} if route == 'gateway' else {'authorization': f'Bearer {key}'}
        with _jev_gate:
            return _post(JEV_URLS[route], headers, body, timeout)

    row = _recorded_call('jev.jsonl', request, send, offline)
    answers = (row.get('answer') or {}).get('answers') or {}
    out = {}
    for name in questions:
        value = (answers.get(name) or {}).get('noul')
        out[name] = value if isinstance(value, (int, float)) and 0 <= value <= 1 else None
    return out, row


def luna(messages, tag, offline=False, json_mode=False, effort=None, max_tokens=None, timeout=300):
    """One gpt-6-luna chat call, no temperature. Returns (text, row). Cost is derived from recorded usage."""
    body = {'model': 'gpt-6-luna', 'messages': messages}
    if json_mode:
        body['response_format'] = {'type': 'json_object'}
    if effort:
        body['reasoning_effort'] = effort
    if max_tokens:
        body['max_completion_tokens'] = max_tokens
    request = {'client': 'openai', 'tag': tag, 'body': body}

    def send():
        return _post('https://api.openai.com/v1/chat/completions',
                     {'authorization': f'Bearer {_key(OPENAI_KEY)}'}, body, timeout)

    row = _recorded_call('luna.jsonl', request, send, offline)
    answer = row.get('answer')
    if not answer:
        return None, row
    return answer['choices'][0]['message'].get('content') or '', row


def luna_cost(row):
    usage = (row.get('answer') or {}).get('usage')
    if not usage:
        return 0.0
    cached = (usage.get('prompt_tokens_details') or {}).get('cached_tokens', 0)
    return ((usage['prompt_tokens'] - cached) * LUNA_PRICE['input'] + cached * LUNA_PRICE['cached']
            + usage['completion_tokens'] * LUNA_PRICE['output']) / 1e6


def run_all(tasks, workers=MAX_WORKERS):
    """tasks: list of zero-argument callables. At most MAX_WORKERS run at a time (never more than eight)."""
    with ThreadPoolExecutor(max_workers=min(workers, 8)) as pool:
        return list(pool.map(lambda task: task(), tasks))
