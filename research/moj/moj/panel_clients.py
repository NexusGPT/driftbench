"""Isolated, budgeted clients. clients_s2.py was absent at this experiment's start.

Prices follow the existing ledger-mm harness: Luna 0.10/0.01/0.50 and
Gemini 0.75/3.75 USD per million input/cached/output tokens. They are estimates,
not invoices. Haiku uses the CLI's reported total_cost_usd. Unknown costs retain
reservations. No shared recording file is written. One process owns a run.
"""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LIMITS = {'luna': 8, 'gemini': 2, 'haiku': 2, 'jev': 8}
MODELS = {'luna': 'gpt-6-luna', 'gemini': 'gemini-3.8-flash', 'haiku': 'haiku', 'jev': 'jev-latest'}
KEYS = {'luna': '~/.nexus-secrets/openai.key', 'gemini': '~/.nexus-secrets/gemini-driftbench.key',
        'jev': '~/.nexus-secrets/nexus-orga.key'}


def digest(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def lines(path):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def append(path, row):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a') as f:
        f.write(json.dumps(row, ensure_ascii=False) + '\n')
        f.flush()
        os.fsync(f.fileno())


def post(url, provider, body):
    # This is the only key read. Neither requests nor headers leave this function.
    key = Path(KEYS[provider]).expanduser().read_text().strip()
    header = {'luna': 'Authorization', 'gemini': 'x-goog-api-key', 'jev': 'api-key'}[provider]
    value = 'Bearer ' + key if provider == 'luna' else key
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json', header: value})
    with urllib.request.urlopen(req, timeout=180) as response:
        return json.loads(response.read())


def send(provider, system, user):
    if provider == 'luna':
        body = {'model': MODELS[provider], 'messages': [{'role': 'system', 'content': system},
                {'role': 'user', 'content': user}], 'reasoning_effort': 'low', 'max_completion_tokens': 2048}
        raw = post('https://api.openai.com/v1/chat/completions', provider, body)
        u = raw.get('usage', {})
        cached = u.get('prompt_tokens_details', {}).get('cached_tokens', 0)
        cost = ((u['prompt_tokens']-cached)*.1+cached*.01+u['completion_tokens']*.5)/1e6 if u else None
        return {'text': raw['choices'][0]['message'].get('content') or '', 'usage': u,
                'model': raw.get('model'), 'usd': cost, 'finish': raw['choices'][0].get('finish_reason')}
    if provider == 'gemini':
        body = {'systemInstruction': {'parts': [{'text': system}]},
                'contents': [{'role': 'user', 'parts': [{'text': user}]}],
                'generationConfig': {'thinkingConfig': {'thinkingLevel': 'low'}, 'maxOutputTokens': 2048}}
        raw = post('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', provider, body)
        u = raw.get('usageMetadata', {})
        cost = (u.get('promptTokenCount', 0)*.75+(u.get('candidatesTokenCount', 0)+u.get('thoughtsTokenCount', 0))*3.75)/1e6 if u else None
        cs = raw.get('candidates') or [{}]
        return {'text': ''.join(p.get('text', '') for p in cs[0].get('content', {}).get('parts', []) if not p.get('thought')),
                'usage': u, 'usd': cost, 'model': raw.get('modelVersion'), 'finish': cs[0].get('finishReason'),
                'feedback': raw.get('promptFeedback')}
    if provider == 'jev':
        raw = post('https://jev-gateway.nexus-orga.gpt.nexus/v1/systemone', provider,
                   {'model': MODELS[provider], 'state': json.loads(user), 'questions': json.loads(system)})
        return {'answers': raw.get('answers'), 'usd': None, 'model': MODELS[provider]}
    env = dict(os.environ)
    env.pop('CLAUDECODE', None)
    env['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'] = '1'
    args = ['claude', '-p', '--output-format', 'json', '--model', 'haiku', '--system-prompt', system,
            '--effort', 'low', '--tools', '', '--setting-sources', '', '--strict-mcp-config',
            '--no-session-persistence', '--max-turns', '1', '--max-budget-usd', '0.10', '--disable-slash-commands']
    with tempfile.TemporaryDirectory(prefix='moj-panel-') as folder:
        proc = subprocess.run(args, input=user, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              cwd=folder, env=env, timeout=240)
    try:
        raw = json.loads(proc.stdout)
    except ValueError:
        raise RuntimeError('CLI returned non-JSON; exit=' + str(proc.returncode)) from None
    # Preserve every returned result, including invalid/refused answers; never ask it again.
    return {'text': raw.get('result', ''), 'usd': raw.get('total_cost_usd'), 'usage': raw.get('usage'),
            'model_usage': raw.get('modelUsage'), 'is_error': raw.get('is_error'), 'exit': proc.returncode}


class Recorder:
    def __init__(self, directory=None, offline=False, budget=10.0, spend_path=None):
        self.directory = Path(directory or ROOT/'results/panel')
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory/'calls.jsonl'
        self.spend_path = Path(spend_path or ROOT/'results/panel/spend.jsonl')
        self.offline, self.budget = offline, budget
        self.lock = threading.RLock()
        self.semaphores = {k: threading.Semaphore(v) for k, v in LIMITS.items()}
        self.keylocks = {}
        self.rows = lines(self.path)
        self.answers = {}
        for r in self.rows:
            if r.get('answer') is not None:
                self.answers.setdefault(r['key'], r)
        self.gemini_stopped = any(r.get('http') == 402 and r.get('provider') == 'gemini' for r in self.rows)

    @contextlib.contextmanager
    def exclusive(self):
        # Prevent concurrent processes from duplicating calls or overrunning the shared budget.
        with self.spend_path.with_suffix('.lock').open('a') as f:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            try:
                yield self
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)

    def spend(self):
        latest = {}
        for r in lines(self.spend_path):
            latest[r['attempt']] = r
        return sum(r.get('usd') if r.get('usd') is not None else r['reserved'] for r in latest.values())

    def accounting(self, key):
        latest = {}
        for row in lines(self.spend_path):
            if row['attempt'].startswith(key + ':'):
                latest[row['attempt']] = row
        return {'calls': len(latest), 'usd': sum(r.get('usd') or 0 for r in latest.values()),
                'cost_complete': bool(latest) and all(r.get('usd') is not None for r in latest.values()),
                'unpriced_reservations_usd': sum(r['reserved'] for r in latest.values() if r.get('usd') is None)}

    def blocked(self, key, provider, request, reason):
        row = {'key': key, 'provider': provider, 'request': request, 'answer': None,
               'error': reason, 'submission': 0, 'not_submitted': True}
        with self.lock:
            append(self.path, row)
            self.rows.append(row)
        return row

    def call(self, provider, system, user, tag):
        request = {'provider': provider, 'model': MODELS[provider], 'system': system, 'user': user,
                   'tag': tag, 'effort': 'low', 'format_version': 1}
        key = digest(request)
        with self.lock:
            lk = self.keylocks.setdefault(key, threading.Lock())
        with lk:
            if key in self.answers:
                return self.answers[key]
            previous = [r for r in self.rows if r['key'] == key]
            if self.offline:
                if previous:
                    return previous[-1]
                raise RuntimeError('Offline recording miss: ' + key)
            holds_path = self.directory/'provider-holds.json'
            holds = json.loads(holds_path.read_text()) if holds_path.exists() else {}
            if provider in holds:
                return self.blocked(key, provider, request, 'User provider pause: ' + holds[provider])
            if provider == 'gemini' and self.gemini_stopped:
                return self.blocked(key, provider, request, 'Gemini stopped after HTTP 402')
            submissions = max([r.get('submission', 0) for r in previous] or [0])
            if previous and previous[-1].get('http') in (400, 401, 403, 404, 413, 422):
                return previous[-1]
            with self.semaphores[provider]:
                if provider == 'gemini' and self.gemini_stopped:
                    return self.blocked(key, provider, request, 'Gemini stopped after HTTP 402')
                for submission in range(submissions + 1, 4):
                    attempt = key + ':' + str(submission)
                    reserve = .10 if provider == 'haiku' else max(.02, len((system+user).encode())*3.75/1e6+.008)
                    with self.lock:
                        if self.spend() + reserve > self.budget:
                            raise RuntimeError('Budget cap: no call submitted')
                        append(self.spend_path, {'attempt': attempt, 'provider': provider, 'reserved': reserve})
                        started_row = {'key': key, 'provider': provider, 'request': request, 'submission': submission,
                                       'answer': None, 'error': 'submission started'}
                        append(self.path, started_row)
                        self.rows.append(started_row)
                    start = time.monotonic()
                    row = {'key': key, 'provider': provider, 'request': request, 'submission': submission}
                    try:
                        row['answer'] = send(provider, system, user)
                    except Exception as error:
                        # Error bodies may contain credential-bearing request details. Store only safe type/status.
                        row.update(answer=None, error=type(error).__name__)
                        if isinstance(error, urllib.error.HTTPError):
                            row['http'] = error.code
                    row['seconds'] = round(time.monotonic()-start, 3)
                    with self.lock:
                        append(self.path, row)
                        self.rows.append(row)
                        if row['answer'] is not None:
                            self.answers[key] = row
                            cost = row['answer'].get('usd')
                            append(self.spend_path, {'attempt': attempt, 'provider': provider,
                                                   'reserved': reserve, 'usd': cost})
                        elif row.get('http') is not None:
                            append(self.spend_path, {'attempt': attempt, 'provider': provider,
                                                   'reserved': reserve, 'usd': 0.0})
                        if provider == 'gemini' and row.get('http') == 402:
                            self.gemini_stopped = True
                    if row['answer'] is not None or row.get('http') in (400, 401, 402, 403, 404, 413, 422):
                        return row
                    if provider == 'gemini' and row.get('http') == 429:
                        time.sleep((60, 120, 240)[submission-1])
                    elif submission < 3:
                        time.sleep(2*submission)
            return next(r for r in reversed(self.rows) if r['key'] == key)


_default_lock = threading.Lock()
_defaults = {}
_default_leases = []


def default_recorder(offline=False):
    """Share pacing and budget state across catalogue calls in this process.

    A process-level caller should hold Recorder.exclusive for the whole run.
    The isolated command-line runners do so automatically.
    """
    with _default_lock:
        if offline not in _defaults:
            if not offline:
                directory = ROOT/'results/panel'
                directory.mkdir(parents=True, exist_ok=True)
                lease = (directory/'spend.lock').open('a')
                try:
                    fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except OSError:
                    lease.close()
                    raise RuntimeError('Another process owns the panel budget') from None
                _default_leases.append(lease)
            _defaults[offline] = Recorder(offline=offline)
        return _defaults[offline]
