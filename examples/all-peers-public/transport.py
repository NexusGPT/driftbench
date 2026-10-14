"""The claude command transport with an append-only journal, a spend cap and network pauses.

Invocation matches the Haiku cells of the ledger lanes (packages/judges createDialectTransport with
provider claude-cli): `claude -p --output-format json --model claude-haiku-5-5 --system-prompt S
--tools '' --setting-sources '' --strict-mcp-config --no-session-persistence --max-turns 1
--max-budget-usd 0.1`, user text on stdin, an empty working folder, 300 s timeout. Added for every
peer: DISABLE_PROMPT_CACHING=1.

Rules:
- A request is keyed by sha256 of model, system and user. An answered key replays from the
  journal and is never sent again; concurrent identical requests wait for the first one.
- A request with no model output (timeout, connection error, error envelope) is a transport
  failure. It is never a judge verdict; the job stays missing and a later pass asks again.
- Three consecutive connection failures pause new requests for ten minutes, then the probe
  gate runs again: ten healthy round trips to api.anthropic.com, 30 seconds apart.
- Every start reserves the per-call cap until its finish row records the measured cost.
"""
import hashlib
import json
import os
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

MODEL = 'claude-haiku-5-5'
CALL_CAP_USD = 0.1
TIMEOUT_S = 300
FLAGS = ['--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence', '--max-turns', '1']
PROBE_URL = 'https://api.anthropic.com/v1/models'


def now():
    return datetime.now(timezone.utc).isoformat()


def request_key(system, user):
    return hashlib.sha256(json.dumps([MODEL, system, user], ensure_ascii=False).encode()).hexdigest()


class Stop(Exception):
    """Dispatch must stop: cap, call limit or an operator stop file."""


class TransportFailure(Exception):
    """No model output was returned for this request."""


def probe_once():
    try:
        urllib.request.urlopen(urllib.request.Request(PROBE_URL, method='GET'), timeout=20)
        return True  # any answer is a completed round trip
    except urllib.error.HTTPError as error:
        return error.code in (401, 403, 404, 405)
    except Exception:
        return False


def probe_gate(log, probes=10, spacing_s=30, sleep=time.sleep):
    """Ten consecutive healthy probes, 30 s apart. A failed probe restarts the count."""
    healthy = 0
    while healthy < probes:
        ok = probe_once()
        healthy = healthy + 1 if ok else 0
        log({'type': 'probe', 'ok': ok, 'healthy': healthy, 'at': now()})
        if healthy < probes:
            sleep(spacing_s)


class Journal:
    def __init__(self, path, cap_usd, run_claude=None, probe=probe_gate, sleep=time.sleep):
        self.path = path
        self.cap_usd = cap_usd
        self.lock = threading.Lock()
        self.run_claude = run_claude or self._run_claude
        self.probe = probe
        self.sleep = sleep
        self.answers = {}      # key -> finish row with an answer
        self.attempts = {}     # key -> attempts made
        self.inflight = {}     # key -> Event
        self.known_usd = 0.0
        self.reserved_usd = 0.0  # starts with no finish, including crashed runs
        self.consecutive_failures = 0
        self.paused_until = 0.0
        self.new_calls = {}    # peer -> paid calls started in this process
        self.call_limit = None
        self.folder = tempfile.mkdtemp(prefix='all-peers-claude-')
        starts, finishes = {}, {}
        parts = os.path.join(os.path.dirname(path), 'calls-parts')
        sources = sorted(os.path.join(parts, n) for n in os.listdir(parts)) if os.path.isdir(parts) else []
        for source in sources + [path]:
            if not os.path.exists(source):
                continue
            with open(source) as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    row = json.loads(line)
                    if row['type'] == 'start':
                        starts[row['attempt_key']] = row
                    elif row['type'] == 'finish':
                        finishes[row['attempt_key']] = row
        for attempt_key, start in starts.items():
            key = start['key']
            self.attempts[key] = max(self.attempts.get(key, 0), start['attempt'])
            finish = finishes.get(attempt_key)
            if finish is None:
                self.reserved_usd += start['reserveUsd']
                continue
            self.known_usd += finish['costUsd']
            if finish.get('answered'):
                self.answers[key] = finish

    def log(self, row):
        with self.lock:
            with open(self.path, 'a') as handle:
                handle.write(json.dumps(row, ensure_ascii=False) + '\n')

    def liability(self):
        return self.known_usd + self.reserved_usd

    def _run_claude(self, system, user):
        env = {k: v for k, v in os.environ.items()
               if k not in ('CLAUDECODE', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDE_JUDGE_MODEL')}
        env['DISABLE_PROMPT_CACHING'] = '1'
        args = ['claude', '-p', '--output-format', 'json', '--model', MODEL, '--system-prompt', system,
                *FLAGS, '--max-budget-usd', str(CALL_CAP_USD)]
        started = time.time()
        try:
            proc = subprocess.run(args, input=user, text=True, capture_output=True, cwd=self.folder, env=env,
                                  timeout=TIMEOUT_S)
        except subprocess.TimeoutExpired:
            return {'answered': False, 'error': 'timeout', 'connection': True, 'elapsedS': time.time() - started}
        elapsed = time.time() - started
        try:
            envelope = json.loads(proc.stdout)
        except ValueError:
            return {'answered': False, 'error': f'exit {proc.returncode} without a JSON result',
                    'stderr': proc.stderr[-2000:], 'connection': True, 'elapsedS': elapsed}
        cost = envelope.get('total_cost_usd')
        usage = envelope.get('usage') or {}
        base = {'elapsedS': elapsed, 'subtype': envelope.get('subtype'), 'stopReason': envelope.get('stop_reason'),
                'models': sorted((envelope.get('modelUsage') or {}).keys()),
                'usage': {k: usage.get(k) for k in ('input_tokens', 'output_tokens', 'cache_read_input_tokens',
                                                    'cache_creation_input_tokens')},
                'measuredCostUsd': cost if isinstance(cost, (int, float)) else None}
        if envelope.get('is_error') or proc.returncode != 0 or envelope.get('subtype') != 'success':
            text = str(envelope.get('result') or '')
            if 'limit' in text.lower() and not (usage.get('output_tokens') or 0):
                # Session-limit replies carry no model output; the lead rules them zero-cost no-answers.
                base = {**base, 'measuredCostUsd': 0.0, 'sessionLimit': True}
            return {**base, 'answered': False, 'error': str(envelope.get('result') or envelope.get('subtype'))[:2000],
                    'connection': envelope.get('subtype') != 'error_max_budget_usd'}
        return {**base, 'answered': True, 'text': envelope.get('result') or ''}

    def call(self, peer, bench, system, user):
        key = request_key(system, user)
        while True:
            with self.lock:
                if key in self.answers:
                    return self.answers[key]['text']
                event = self.inflight.get(key)
                if event is None:
                    self._admit(peer)
                    attempt = self.attempts.get(key, 0) + 1
                    self.attempts[key] = attempt
                    event = self.inflight[key] = threading.Event()
                    self.reserved_usd += CALL_CAP_USD
                    self.new_calls[peer] = self.new_calls.get(peer, 0) + 1
                    owner = True
                else:
                    owner = False
            if not owner:
                event.wait()
                with self.lock:
                    if key in self.answers:
                        return self.answers[key]['text']
                raise TransportFailure('shared request returned no answer')
            break
        attempt_key = f'{key}:{attempt}'
        self.log({'type': 'start', 'key': key, 'attempt': attempt, 'attempt_key': attempt_key, 'peer': peer,
                  'bench': bench, 'reserveUsd': CALL_CAP_USD, 'at': now()})
        try:
            result = self.run_claude(system, user)
        except Exception as error:  # an unexpected local failure keeps its reservation
            result = {'answered': False, 'error': f'local: {error!r}', 'connection': False}
        measured = result.get('measuredCostUsd')
        cost = measured if isinstance(measured, (int, float)) else CALL_CAP_USD
        finish = {'type': 'finish', 'key': key, 'attempt': attempt, 'attempt_key': attempt_key, 'peer': peer,
                  'bench': bench, 'costUsd': cost, 'costEstimated': measured is None, 'at': now(), **result}
        self.log(finish)
        with self.lock:
            self.reserved_usd -= CALL_CAP_USD
            self.known_usd += cost
            if result['answered']:
                self.answers[key] = finish
                self.consecutive_failures = 0
            elif result.get('connection'):
                self.consecutive_failures += 1
                if self.consecutive_failures >= 3:
                    self.paused_until = float('inf')
            self.inflight.pop(key).set()
        if not result['answered']:
            if result.get('connection'):
                raise TransportFailure(result.get('error'))
            raise TransportFailure(f"no answer: {result.get('error')}")
        return finish['text']

    def _admit(self, peer):
        """Called under the lock before a new paid request."""
        if os.path.exists(self.path + '.stop'):
            raise Stop('operator stop file present')
        if self.call_limit is not None and self.new_calls.get(peer, 0) >= self.call_limit:
            raise Stop(f'call limit {self.call_limit} reached for {peer}')
        if self.liability() + CALL_CAP_USD > self.cap_usd:
            raise Stop(f'cap {self.cap_usd} USD would be exceeded at liability {self.liability():.4f}')
        while self.paused_until > time.time() or self.paused_until == float('inf'):
            if self.paused_until == float('inf'):
                self.paused_until = time.time() + 600
                self.log_unlocked({'type': 'pause', 'reason': 'three consecutive connection failures', 'at': now()})
            wait = self.paused_until - time.time()
            self.lock.release()
            try:
                if wait > 0:
                    self.sleep(wait)
                self.probe(self.log)
            finally:
                self.lock.acquire()
            self.paused_until = 0.0
            self.consecutive_failures = 0

    def log_unlocked(self, row):
        with open(self.path, 'a') as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + '\n')
