"""Run verify contestants with Claude Haiku 5.5 called through the Anthropic Messages API instead of `claude -p`.

Same model, same system and user text, no sampling parameter (the CLI sets none either), so a request keeps
its journal key and every answer the CLI already recorded replays free. Only the transport of new requests
changes: the official Python SDK, 16000 max tokens, a 300 s timeout, the SDK's retries with backoff on 429,
5xx and connection errors (8 retries), cost from the response usage at the Haiku 5.5 rate. Finish rows carry
`transport: api`. The key is read inside the process from the file named by ANTHROPIC_KEY_FILE.

  ANTHROPIC_KEY_FILE=~/.nexus-secrets/anthropic-driftbench.key \\
    python examples/verify-lead/api_run.py [--root DIR] [--ljb-test] -- --split confirm --contestants ... --execute
"""
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / 'all-peers-public'))
sys.path.insert(0, str(ROOT))  # first, so `run` is this folder's runner

import anthropic  # noqa: E402
import transport  # noqa: E402

MAX_TOKENS = 16000
INPUT_USD, OUTPUT_USD = 0.10 / 1e6, 0.50 / 1e6  # Haiku 5.5 per token, prompts up to 100K tokens
LONG_INPUT_USD, LONG_OUTPUT_USD = 0.50 / 1e6, 2.50 / 1e6  # above 100K prompt tokens
_client = None


def client():
    global _client
    if _client is None:
        key = Path(os.path.expanduser(os.environ['ANTHROPIC_KEY_FILE'])).read_text().strip()
        workspace = os.environ.get('ANTHROPIC_WORKSPACE_ID')  # needed when the key is not scoped to a workspace
        headers = {'anthropic-workspace-id': workspace} if workspace else None
        _client = anthropic.Anthropic(api_key=key, timeout=transport.TIMEOUT_S, max_retries=8,
                                      default_headers=headers)
    return _client


def cost_usd(usage):
    prompt = (usage.input_tokens or 0) + (usage.cache_read_input_tokens or 0) + (usage.cache_creation_input_tokens or 0)
    rate_in, rate_out = (LONG_INPUT_USD, LONG_OUTPUT_USD) if prompt > 100_000 else (INPUT_USD, OUTPUT_USD)
    return prompt * rate_in + (usage.output_tokens or 0) * rate_out


def api_run_claude(self, system, user):
    started = time.time()
    try:
        message = client().messages.create(model=transport.MODEL, max_tokens=MAX_TOKENS, system=system,
                                           messages=[{'role': 'user', 'content': user}])
    except anthropic.RateLimitError as error:
        return {'answered': False, 'error': f'429 after retries: {error}'[:2000], 'connection': True,
                'transport': 'api', 'elapsedS': time.time() - started}
    except anthropic.APIStatusError as error:
        return {'answered': False, 'error': f'{error.status_code}: {error}'[:2000],
                'connection': error.status_code >= 500, 'transport': 'api', 'elapsedS': time.time() - started,
                'measuredCostUsd': 0.0 if error.status_code < 500 else None}  # a rejected request bills no tokens
    except anthropic.APIConnectionError as error:
        return {'answered': False, 'error': f'connection: {error}'[:2000], 'connection': True,
                'transport': 'api', 'elapsedS': time.time() - started}
    usage = message.usage
    text = ''.join(block.text for block in message.content if block.type == 'text')
    base = {'transport': 'api', 'elapsedS': time.time() - started, 'stopReason': message.stop_reason,
            'models': [message.model],
            'usage': {k: getattr(usage, k, None) for k in ('input_tokens', 'output_tokens', 'cache_read_input_tokens',
                                                            'cache_creation_input_tokens')},
            'measuredCostUsd': cost_usd(usage)}
    if not text:
        return {**base, 'answered': False, 'error': f'no text, stop_reason {message.stop_reason}', 'connection': False}
    return {**base, 'answered': True, 'text': text}


def main(argv):
    root, ljb = None, False
    while argv and argv[0] != '--':
        flag = argv.pop(0)
        if flag == '--root':
            root = Path(argv.pop(0)).resolve()
        elif flag == '--ljb-test':
            ljb = True
        else:
            raise SystemExit(__doc__)
    argv = argv[1:]
    transport.Journal._run_claude = api_run_claude
    import run as runner
    if root is not None:
        runner.ROOT = root
    if ljb:
        runner.SPLITS = (*runner.SPLITS, 'ljb-test')
    split = argv[argv.index('--split') + 1]
    if split not in runner.SPLITS:
        runner.SPLITS = (*runner.SPLITS, split)
    sys.argv = ['run.py', *argv]
    return runner.main()


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
