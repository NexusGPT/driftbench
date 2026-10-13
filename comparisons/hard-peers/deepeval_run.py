"""DeepEval 4.2.8 default metrics on one frozen held-out row, through the same lean Claude call as our side.

The metric classes, their templates and the Haiku model adapter are the earlier comparison's own
(comparisons/deepeval/hard/run.py `metrics`), unchanged. Only the recorder differs: prompt caching disabled,
network probe gate, a pause after three consecutive failures, missing-only reruns, one shared 25 USD cap.
Usage, with deepeval==4.2.8 installed: python comparisons/hard-peers/deepeval_run.py <task|knowledge|completeness> [--replay] [--limit N] [--max-fresh N]
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
CAP_USD = 25.0
PER_CALL_USD = 0.05
METRIC = {'task': 'task completion', 'knowledge': 'knowledge retention', 'completeness': 'conversation completeness'}


def verify_freeze():
    frozen = json.loads((HERE / 'freeze.json').read_text())
    for path, digest in frozen['sha256'].items():
        if hashlib.sha256((REPO / path).read_bytes()).hexdigest() != digest:
            raise SystemExit(f'Changed after the freeze: {path}')


def spent_usd():
    total = 0.0
    for path in sorted((HERE / 'calls').glob('*.jsonl')):
        for line in path.read_text().splitlines():
            if line.strip():
                record = json.loads(line)
                total += float(record.get('reservedUsd' if path.name.startswith('failures') else 'costUsd') or 0)
    return total


def probe_once():
    try:
        urllib.request.urlopen(urllib.request.Request('https://api.anthropic.com/', method='HEAD'), timeout=10)
        return True
    except urllib.error.HTTPError:
        return True
    except Exception:
        return False


def probe_gate(reason):
    """Ten healthy network probes, 30 seconds apart. No model call."""
    print(json.dumps({'gate': reason, 'at': datetime.now().astimezone().isoformat()}), flush=True)
    healthy = 0
    while healthy < 10:
        healthy = healthy + 1 if probe_once() else 0
        if healthy < 10:
            time.sleep(30)
    print(json.dumps({'gate': 'open', 'at': datetime.now().astimezone().isoformat()}), flush=True)


class Missing(Exception):
    pass


class Recorder:
    def __init__(self, row, replay, max_fresh=None):
        self.row, self.replay, self.max_fresh = row, replay, max_fresh
        self.path = HERE / f'calls/deepeval-theirs-{row}.jsonl'
        self.failures = HERE / f'calls/failures-deepeval-{row}.jsonl'
        self.cache = {}
        if self.path.exists():
            for line in self.path.read_text().splitlines():
                if line.strip():
                    record = json.loads(line)
                    self.cache[record['key']] = record
        self.spent = spent_usd()
        self.fresh = 0
        self.consecutive = 0
        self.keys = []
        self.case = None
        self.seen = {}

    def call(self, system, user):
        # A metric may ask the same prompt twice within one case; each occurrence is its own call.
        occurrence = self.seen.get((system, user), 0)
        self.seen[(system, user)] = occurrence + 1
        key = hashlib.sha256(json.dumps(['haiku', system, user, occurrence], ensure_ascii=False).encode()).hexdigest()
        self.keys.append(key)
        if key in self.cache:
            return self.cache[key]['text']
        if self.replay or (self.max_fresh is not None and self.fresh >= self.max_fresh):
            raise Missing(key)
        if self.spent + PER_CALL_USD > CAP_USD:
            raise SystemExit(f'Budget cap {CAP_USD} USD reached')
        args = ['claude', '-p', '--output-format', 'json', '--model', 'haiku', '--system-prompt', system,
                '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
                '--max-turns', '1', '--max-budget-usd', str(PER_CALL_USD)]
        env = {k: v for k, v in os.environ.items() if k != 'CLAUDECODE'}
        env['DISABLE_PROMPT_CACHING'] = '1'
        cwd = HERE / '.cache/runtime'
        cwd.mkdir(parents=True, exist_ok=True)
        text, cost, usage, failure = '', None, None, None
        try:
            proc = subprocess.run(args, input=user, text=True, capture_output=True, cwd=cwd, env=env, timeout=150)
            envelope = json.loads(proc.stdout)
            if isinstance(envelope.get('total_cost_usd'), (int, float)) and envelope['total_cost_usd'] >= 0:
                cost = float(envelope['total_cost_usd'])
            text = str(envelope.get('result', ''))
            usage = envelope.get('modelUsage') or envelope.get('usage')
            if proc.returncode or envelope.get('is_error') or not text:
                failure = json.dumps({'code': proc.returncode, 'subtype': envelope.get('subtype'), 'stderr': proc.stderr[:300]})
        except Exception as exc:
            failure = repr(exc)[:300]
        stamp = datetime.now().astimezone().isoformat()
        if failure:
            reserved = cost if cost is not None else PER_CALL_USD
            self.spent += reserved
            with self.failures.open('a') as f:
                f.write(json.dumps({'key': key, 'row': self.row, 'id': self.case, 'failure': failure,
                                    'reservedUsd': reserved, 'timestamp': stamp}) + '\n')
            self.consecutive += 1
            if self.consecutive >= 3:
                time.sleep(600)
                probe_gate('three consecutive failures; paused 10 minutes')
                self.consecutive = 0
            raise Missing(key)
        self.consecutive = 0
        record = {'key': key, 'competitor': 'deepeval', 'row': self.row, 'contestant': 'theirs', 'id': self.case,
                  'prompt': {'system': system, 'user': user}, 'text': text, 'costUsd': cost if cost is not None else PER_CALL_USD,
                  'modelUsage': usage, 'timestamp': stamp}
        with self.path.open('a') as f:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
            f.flush()
            os.fsync(f.fileno())
        self.cache[key] = record
        self.spent += record['costUsd']
        self.fresh += 1
        return text


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('row', choices=list(METRIC))
    ap.add_argument('--replay', action='store_true')
    ap.add_argument('--limit', type=int)
    ap.add_argument('--max-fresh', type=int)
    args = ap.parse_args()
    if importlib.metadata.version('deepeval') != '4.2.8':
        raise SystemExit('Requires deepeval==4.2.8')
    os.environ.setdefault('DEEPEVAL_TELEMETRY_OPT_OUT', 'YES')
    verify_freeze()
    sys.path.insert(0, str(REPO / 'comparisons/deepeval/hard'))
    from run import metrics  # the earlier comparison's metric wiring and model adapter, unchanged
    (HERE / 'calls').mkdir(exist_ok=True)
    (HERE / 'results').mkdir(exist_ok=True)
    recorder = Recorder(args.row, args.replay, args.max_fresh)
    measure = metrics(recorder)
    items = json.loads((HERE / f'sets/deepeval-{args.row}.json').read_text())[:args.limit]
    if not args.replay:
        probe_gate('start')
    results = []
    for n, item in enumerate(items, 1):
        recorder.case, recorder.keys, recorder.seen = item['id'], [], {}
        base = {'id': item['id'], 'kind': item['kind'], 'pair': item['pair'], 'truth': item['truth']}
        try:
            verdict = measure(METRIC[args.row], item)
            results.append({**base, 'complete': True, 'prediction': verdict['prediction'], 'score': verdict['score'],
                            'keys': list(recorder.keys)})
        except Missing:
            results.append({**base, 'complete': False})
        except ValueError as exc:
            # An answered call DeepEval could not use: its own error, scored as no verdict.
            results.append({**base, 'complete': True, 'prediction': None, 'error': str(exc)[:300], 'keys': list(recorder.keys)})
        if n % 10 == 0:
            print(json.dumps({'row': args.row, 'done': n, 'fresh': recorder.fresh, 'spentUsd': round(recorder.spent, 4)}), flush=True)
    out = {'competitor': 'deepeval', 'row': args.row, 'contestant': 'theirs', 'metric': METRIC[args.row],
           'package': 'deepeval==4.2.8', 'model': 'haiku', 'items': len(items),
           'complete': sum(r['complete'] for r in results), 'results': results}
    (HERE / f'results/deepeval-{args.row}-theirs.json').write_text(json.dumps(out, indent=2) + '\n')
    print(json.dumps({k: v for k, v in out.items() if k != 'results'} | {'fresh': recorder.fresh, 'spentUsd': recorder.spent}))


if __name__ == '__main__':
    main()
