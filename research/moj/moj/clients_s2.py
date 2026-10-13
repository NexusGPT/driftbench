"""Recorded clients for the pointwise benchmarks: System 1 (Jev) and three System-2 models.

  jev_pw(state, questions)            System 1, same request shape as moj/client.py
  s2(model, system, user, tag)        System 2: 'luna' (gpt-6-luna), 'gemini' (gemini-3.8-flash), 'haiku' (local claude CLI)

Same recorder as moj/client.py (its digest, compact copy, JSONL rows and first-answer rule), in separate files so
the pairwise recordings are never touched: recordings/pw-jev.jsonl, pw-luna.jsonl, pw-gemini.jsonl, pw-haiku.jsonl.
A returned answer is never asked again. A call with no answer is submitted at most three times.

Pacing: Jev 8 calls at a time, gpt-6-luna 8, Gemini 2, Haiku 2 (each Haiku call starts a local process).
Gemini: HTTP 429 waits 60, 120, 240 seconds; HTTP 402 stops every later Gemini call of the process at once.
Budget: fresh System-2 calls stop when the recorded System-2 spend reaches BUDGET_USD.
Keys are read from a file inside the call and never written, printed or logged.
"""
import json
import os
import subprocess
import tempfile
import threading
import time
import urllib.error

from . import client
from .client import HERE, MAX_SUBMISSIONS, compact, digest

FILES = {'jev': 'pw-jev.jsonl', 'luna': 'pw-luna.jsonl', 'gemini': 'pw-gemini.jsonl', 'haiku': 'pw-haiku.jsonl'}
MODELS = {'luna': 'gpt-6-luna', 'gemini': 'gemini-3.8-flash', 'haiku': 'haiku'}
LIMITS = {'jev': 8, 'luna': 8, 'gemini': 2, 'haiku': 2}
GEMINI_KEY = '~/.nexus-secrets/gemini-driftbench.key'
GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
GEMINI_PRICE = {'input': 0.75, 'output': 3.75}  # USD per 1M tokens; thinking tokens are billed as output
QUOTA_WAITS = (60, 120, 240)
HAIKU_FLAGS = ['-p', '--output-format', 'json', '--model', 'haiku', '--tools', '', '--setting-sources', '', '--strict-mcp-config',
               '--no-session-persistence', '--max-turns', '1']
HAIKU_CALL_CAP_USD = 0.5
BUDGET_USD = 15.0
_slots = {name: threading.BoundedSemaphore(limit) for name, limit in LIMITS.items()}
_state_lock = threading.Lock()
_stopped = {}  # model -> reason; set by HTTP 402 or by the budget
_spent = {'usd': None}
_refused = {}


class NoAnswer(Exception):
    """A call that returned no answer. `final` means no further submission makes sense."""

    def __init__(self, text, final=False, wait=0):
        super().__init__(text)
        self.final, self.wait = final, wait


def cost(model, row):
    """USD of one recorded answer, from its recorded usage."""
    answer = row.get('answer') if row else None
    if not answer:
        return 0.0
    if model == 'luna':
        return client.luna_cost(row)
    if model == 'gemini':
        usage = answer.get('usageMetadata') or {}
        return (usage.get('promptTokenCount', 0) * GEMINI_PRICE['input']
                + (usage.get('candidatesTokenCount', 0) + usage.get('thoughtsTokenCount', 0)) * GEMINI_PRICE['output']) / 1e6
    if model == 'haiku':
        value = answer.get('total_cost_usd')
        return float(value) if isinstance(value, (int, float)) else 0.0
    return 0.0


def spend():
    """Recorded System-2 spend of the pointwise work, per model, from the recordings."""
    out = {}
    for model in MODELS:
        with client._lock:
            rows = client._load(FILES[model])
        out[model] = {'answers': len(rows), 'usd': round(sum(cost(model, row) for row in rows.values()), 6)}
    out['total_usd'] = round(sum(entry['usd'] for entry in out.values()), 6)
    out['budget_usd'] = BUDGET_USD
    return out


def write_spend():
    path = os.path.join(HERE, 'results', 'pointwise', 'spend.json')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    report = {**spend(), 'stopped': dict(_stopped),
              'note': 'System-2 spend of the pointwise benchmarks, derived from recorded usage. Haiku is the cost the local CLI reports.'}
    json.dump(report, open(path, 'w'), indent=1)
    return report


def _reserve(model):
    with _state_lock:
        if _spent['usd'] is None:
            _spent['usd'] = spend()['total_usd']
        if _spent['usd'] >= BUDGET_USD:
            _stopped.setdefault(model, f'System-2 budget of {BUDGET_USD} USD reached')
        return _stopped.get(model)


def _recorded(model, request, send, offline):
    """Replay a recorded answer, or submit up to three times and record the first answer."""
    name, key = FILES[model], digest(request)
    with client._lock:
        rows = client._load(name)
    if key in rows:
        return rows[key]
    with client._key_lock(key):  # an identical request in flight is joined, never sent twice
        if key in rows:
            return rows[key]
        if offline:
            raise RuntimeError(f'recording miss in offline mode: {name} {key[:12]}')
        last = None
        for submission in range(1, MAX_SUBMISSIONS + 1):
            held = _reserve(model) if model != 'jev' else None
            if held:
                return {'key': key, 'answer': None, 'error': f'not sent: {held}'}
            started = time.time()
            try:
                with _slots[model]:
                    started = time.time()
                    answer = send(submission)
                row = {'key': key, 'request': compact(request), 'answer': answer, 'seconds': round(time.time() - started, 3),
                       'submission': submission}
                client._append(name, row)
                if model != 'jev':
                    with _state_lock:
                        _spent['usd'] = (_spent['usd'] or 0.0) + cost(model, row)
                return row
            except Exception as error:  # no answer: transport, HTTP or process error
                last = str(error)[:400] if isinstance(error, NoAnswer) else client._redact(error)
                client._append(name, {'key': key, 'answer': None, 'error': last, 'submission': submission,
                                      'seconds': round(time.time() - started, 3)})
                if isinstance(error, NoAnswer) and error.final:
                    break
                if isinstance(error, urllib.error.HTTPError) and error.code in (400, 401, 403, 404, 413, 422):
                    break
                time.sleep(error.wait if isinstance(error, NoAnswer) and error.wait else 2 * submission)
        return {'key': key, 'request': compact(request), 'answer': None, 'error': last}


def _refusals():
    """Keys of the System-1 requests the gateway refused with HTTP 403, from the recording."""
    if 'keys' not in _refused:
        keys, path = set(), os.path.join(client.REC, FILES['jev'])
        if os.path.exists(path):
            with open(path) as handle:
                for line in handle:
                    row = json.loads(line)
                    if row.get('answer') is None and str(row.get('error', '')).startswith('HTTP 403'):
                        keys.add(row['key'])
        with client._lock:
            answered = set(client._load(FILES['jev']))
        _refused['keys'] = keys - answered  # a refusal the gateway later answered is not a refusal
    return _refused['keys']


def jev_pw(state, questions, route='gateway', model='jev-latest', offline=False, timeout=60, repeat=0):
    """questions: {name: {'question': str}}. Returns ({name: probability of yes}, row). `repeat` keys a fresh sample."""
    body = {'model': model, 'state': state,
            'questions': {name: {'type': 'noul', 'instructions': spec} for name, spec in questions.items()}}
    request = {'client': 'jev', 'route': route, 'body': body}
    if repeat:
        request['repeat'] = repeat

    def send(_submission):
        key = client._key(client.JEV_KEYS[route])
        headers = {'api-key': key} if route == 'gateway' else {'authorization': f'Bearer {key}'}
        return client._post(client.JEV_URLS[route], headers, body, timeout)

    # The gateway refuses some bodies before they reach the model (403 from its front). The direct route takes them.
    # A recorded refusal is never sent to the gateway again, online or offline.
    refused = route == 'gateway' and digest(request) in _refusals()
    row = {'answer': None, 'error': 'HTTP 403'} if refused else _recorded('jev', request, send, offline)
    if row.get('answer') is None and route == 'gateway' and str(row.get('error', '')).startswith('HTTP 403'):
        with _state_lock:
            _refusals().add(digest(request))
        return jev_pw(state, questions, route='typesafe', model=model, offline=offline, timeout=timeout, repeat=repeat)
    answers = (row.get('answer') or {}).get('answers') or {}
    out = {}
    for name in questions:
        value = (answers.get(name) or {}).get('noul')
        out[name] = value if isinstance(value, (int, float)) and 0 <= value <= 1 else None
    return out, row


def _luna(system, user, json_mode, effort, max_tokens, timeout):
    body = {'model': 'gpt-6-luna', 'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}]}
    if json_mode:
        body['response_format'] = {'type': 'json_object'}
    if effort:
        body['reasoning_effort'] = effort
    if max_tokens:
        body['max_completion_tokens'] = max_tokens

    def send(_submission):  # no temperature parameter is sent
        return client._post('https://api.openai.com/v1/chat/completions',
                            {'authorization': f'Bearer {client._key(client.OPENAI_KEY)}'}, body, timeout)

    def text(answer):
        return answer['choices'][0]['message'].get('content') or ''
    return body, send, text


def _gemini(system, user, json_mode, effort, max_tokens, timeout):
    config = {'maxOutputTokens': max_tokens or 8192}
    if effort:
        config['thinkingConfig'] = {'thinkingLevel': effort}
    if json_mode:
        config['responseMimeType'] = 'application/json'
    body = {'systemInstruction': {'parts': [{'text': system}]}, 'contents': [{'role': 'user', 'parts': [{'text': user}]}],
            'generationConfig': config}

    def send(submission):
        try:
            return client._post(GEMINI_URL, {'x-goog-api-key': client._key(GEMINI_KEY)}, body, timeout)
        except urllib.error.HTTPError as error:
            if error.code == 402:  # billing rejection: stop Gemini at once, nothing is retried
                with _state_lock:
                    _stopped['gemini'] = 'HTTP 402 from Gemini (billing): stopped at once'
                raise NoAnswer('HTTP 402: billing rejection, Gemini stopped', final=True)
            if error.code == 429:  # shared quota: wait 60, 120, 240 seconds
                wait = QUOTA_WAITS[min(submission, len(QUOTA_WAITS)) - 1]
                time.sleep(wait)  # the slot stays held while waiting, so the shared quota is left alone
                raise NoAnswer(f'HTTP 429: quota, waited {wait} s', wait=0.01)
            raise

    def text(answer):
        candidate = (answer.get('candidates') or [{}])[0]
        return ''.join(part.get('text', '') for part in (candidate.get('content') or {}).get('parts', []) if not part.get('thought'))
    return body, send, text


def _haiku(system, user, json_mode, effort, max_tokens, timeout):
    body = {'flags': HAIKU_FLAGS, 'system': system, 'user': user}

    def send(_submission):
        env = dict(os.environ)
        env.pop('CLAUDECODE', None)
        try:
            ran = subprocess.run([os.environ.get('CLAUDE_BIN', 'claude'), *HAIKU_FLAGS, '--system-prompt', system,
                                  '--max-budget-usd', str(HAIKU_CALL_CAP_USD)],
                                 input=user, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 cwd=tempfile.gettempdir(), env=env, timeout=timeout)
            raw = json.loads(ran.stdout)
        except subprocess.TimeoutExpired:
            raise NoAnswer(f'claude CLI timed out after {timeout} s')
        except ValueError:
            raise NoAnswer('claude CLI gave no JSON')
        if ran.returncode != 0 or raw.get('subtype') != 'success' or raw.get('is_error'):
            raise NoAnswer(f"claude CLI: exit {ran.returncode}, subtype {raw.get('subtype')}, {str(raw.get('result', ''))[:200]}")
        return {'result': raw.get('result', ''), 'total_cost_usd': raw.get('total_cost_usd'), 'usage': raw.get('usage'),
                'resolved_model': sorted(raw.get('modelUsage', {})), 'duration_ms': raw.get('duration_ms'), 'subtype': raw.get('subtype')}

    def text(answer):
        return answer.get('result') or ''
    return body, send, text


_BUILD = {'luna': _luna, 'gemini': _gemini, 'haiku': _haiku}


def s2(model, system, user, tag, offline=False, json_mode=False, effort='medium', max_tokens=None, timeout=300, repeat=0):
    """One System-2 call. Returns (text or None, row). `repeat` keys a fresh sample of the same request."""
    body, send, text = _BUILD[model](system, user, json_mode, effort if model != 'haiku' else None, max_tokens, timeout)
    request = {'client': model, 'model': MODELS[model], 'tag': tag, 'body': body}
    if repeat:
        request['repeat'] = repeat
    row = _recorded(model, request, send, offline)
    answer = row.get('answer')
    return (text(answer) if answer else None), row


def stopped():
    return dict(_stopped)
