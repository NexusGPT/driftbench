"""The Anthropic Messages API in place of the claude command, for the same request.

`run_api(system, user)` returns the same result shape as Journal._run_claude in
examples/all-peers-public/transport.py, so a Journal built with run_claude=run_api keeps its keys,
replays every answer already recorded and only changes how a new request is sent.

Same model and prompts as the claude command: the system prompt as the system field, the user text
as the one user message, no tools, no temperature (the command sends none, so both use the API
default). Retries 429 and 5xx with backoff. Cost comes from the usage field at the rates the claude
command billed for this model (0.10 USD per million input tokens, 0.50 per million output tokens,
fitted exactly on 4,896 recorded calls).
"""
import json
import os
import random
import time
import urllib.error
import urllib.request

MODEL = 'claude-haiku-5-5'
MAX_TOKENS = 8192
USD_PER_TOKEN = {'input': 0.10 / 1e6, 'output': 0.50 / 1e6}
URL = 'https://api.anthropic.com/v1/messages'
WAITS_S = (5, 15, 30, 60, 120, 240)


def _key():
    with open(os.path.expanduser('~/.nexus-secrets/anthropic-driftbench.key')) as handle:
        return handle.read().strip()


def _workspace_headers():
    # An organisation key that is not scoped to one workspace must name the workspace that is billed.
    workspace = os.environ.get('ANTHROPIC_WORKSPACE_ID', '').strip()
    return {'anthropic-workspace-id': workspace} if workspace else {}


def cost_of(usage):
    return (usage.get('input_tokens', 0) * USD_PER_TOKEN['input'] + usage.get('output_tokens', 0) * USD_PER_TOKEN['output'])


def run_api(system, user, sleep=time.sleep):
    body = json.dumps({'model': MODEL, 'max_tokens': MAX_TOKENS, 'system': system,
                       'messages': [{'role': 'user', 'content': user}]}).encode()
    started, last = time.time(), None
    for attempt in range(len(WAITS_S) + 1):
        request = urllib.request.Request(URL, data=body, method='POST', headers={
            'x-api-key': _key(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
            **_workspace_headers()})
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                payload = json.load(response)
            break
        except urllib.error.HTTPError as error:
            text = error.read()[:500].decode('utf-8', 'replace')
            last = f'HTTP {error.code}: {text}'
            if error.code != 429 and error.code < 500:
                return {'answered': False, 'error': last, 'connection': False, 'measuredCostUsd': 0.0,
                        'elapsedS': time.time() - started, 'transport': 'anthropic-api'}
            retry_after = error.headers.get('retry-after') if error.headers else None
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last, retry_after = f'network: {error}', None
        if attempt == len(WAITS_S):
            return {'answered': False, 'error': f'retries exhausted: {last}'[:2000], 'connection': True,
                    'measuredCostUsd': 0.0, 'elapsedS': time.time() - started, 'transport': 'anthropic-api'}
        wait = float(retry_after) if retry_after and retry_after.replace('.', '', 1).isdigit() else WAITS_S[attempt]
        sleep(wait + random.random())
    usage = payload.get('usage') or {}
    text = ''.join(part.get('text', '') for part in payload.get('content') or [] if part.get('type') == 'text')
    base = {'elapsedS': time.time() - started, 'stopReason': payload.get('stop_reason'), 'models': [payload.get('model')],
            'usage': {k: usage.get(k) for k in ('input_tokens', 'output_tokens', 'cache_read_input_tokens',
                                                'cache_creation_input_tokens')},
            'measuredCostUsd': cost_of(usage), 'transport': 'anthropic-api'}
    if payload.get('stop_reason') in ('refusal', 'max_tokens') or not text:
        return {**base, 'answered': False, 'error': f"stop_reason {payload.get('stop_reason')}", 'connection': False}
    return {**base, 'answered': True, 'text': text}
