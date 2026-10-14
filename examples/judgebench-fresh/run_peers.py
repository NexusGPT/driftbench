"""Run the PR 351 peer graders on one split of the "JudgeBench recipe, fresh pool", missing items only.

Each peer runs its own shipped pairwise grader exactly as examples/all-peers-public/run.py runs it
for JudgeBench (DeepEval ArenaGEval, LangWatch Comparison; Inspect and Langfuse score each reply
alone and the higher score wins). Calls go through the PR 351 claude transport with this folder's
own journal. Without --execute it prints the plan and makes no call.

  python examples/judgebench-fresh/run_peers.py --split dev --peers deepeval,langwatch --execute
"""
import argparse
import fcntl
import json
import os
import sys
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PEERS_DIR = ROOT.parent / 'all-peers-public'
sys.path.insert(0, str(PEERS_DIR))
sys.path.insert(0, str(ROOT))
os.environ.setdefault('DEEPEVAL_TELEMETRY_OPT_OUT', 'YES')
os.environ.setdefault('DEEPEVAL_UPDATE_WARNING_OPT_IN', 'NO')

import peers  # noqa: E402
from run import run_job  # noqa: E402
from transport import Journal, Stop, TransportFailure, now, probe_gate, request_key  # noqa: E402

CRITERION = ('The response gives the correct answer to the question. Only objective correctness counts: '
             'a correct answer beats a fluent wrong one.')


def items_for(split):
    rows = [json.loads(line) for line in (ROOT / 'pool' / f'{split}.jsonl').read_text().splitlines() if line.strip()]
    return [{'id': r['pair_id'], 'group': 'mmlu' if r['source'].startswith('mmlu') else 'livebench',
             'label': 'A' if r['label'] == 'A>B' else 'B', 'question': r['question'],
             'a': r['response_A'], 'b': r['response_B'], 'criterion': CRITERION} for r in rows]


def decisions_path(split, peer):
    return ROOT / 'cells' / split / peer / 'decisions.jsonl'


def done_ids(split, peer):
    path = decisions_path(split, peer)
    if not path.exists():
        return set()
    return {json.loads(line)['id'] for line in path.read_text().splitlines() if line.strip()}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--split', choices=('dev', 'confirm'), required=True)
    ap.add_argument('--peers', required=True)
    ap.add_argument('--execute', action='store_true')
    ap.add_argument('--cap-usd', type=float, default=5.0, help='journal-wide liability cap, all runs together')
    ap.add_argument('--workers', type=int, default=3, help='per peer')
    ap.add_argument('--skip-probe', action='store_true')
    ap.add_argument('--transport', choices=('cli', 'api'), default='cli',
                    help='cli: the claude command; api: the Anthropic Messages API (api_transport.py), same keys and replay')
    args = ap.parse_args()
    chosen = args.peers.split(',')
    if any(p not in peers.PAIR_PEERS for p in chosen):
        raise SystemExit(f'peers: any of {peers.PAIR_PEERS}')
    items = items_for(args.split)
    plan = {p: [i for i, x in enumerate(items) if x['id'] not in done_ids(args.split, p)] for p in chosen}
    print(json.dumps({'split': args.split, 'items': len(items), 'missing': {p: len(v) for p, v in plan.items()},
                      'execute': args.execute}), flush=True)
    if not args.execute:
        return 0
    (ROOT / 'cells').mkdir(exist_ok=True)
    lock = open(ROOT / 'cells' / '.peers-run.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    run_claude = None
    if args.transport == 'api':
        from api_transport import run_api as run_claude
    journal = Journal(str(ROOT / 'cells' / 'peer-calls.jsonl'), args.cap_usd, run_claude=run_claude)
    if not args.skip_probe:
        probe_gate(journal.log)
    write_lock, stop = threading.Lock(), threading.Event()
    counts = {p: {'decided': 0, 'missing': 0} for p in chosen}

    def work(peer, index):
        if stop.is_set():
            return
        item = items[index]
        keys = []

        def call(system, user):
            keys.append(request_key(system, user))
            return journal.call(peer, 'judgebench-fresh', system, user)
        try:
            row = run_job('judgebench', peer, index, item, call)
        except Stop as error:
            stop.set()
            print(json.dumps({'stop': str(error)}), flush=True)
            return
        except TransportFailure as error:
            counts[peer]['missing'] += 1
            print(json.dumps({'peer': peer, 'id': item['id'], 'missing': str(error)[:200]}), flush=True)
            return
        except Exception:
            stop.set()
            traceback.print_exc()
            return
        row = {'id': item['id'], 'peer': peer, 'label': item['label'], **row, 'callKeys': keys, 'at': now()}
        path = decisions_path(args.split, peer)
        with write_lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, 'a') as handle:
                handle.write(json.dumps(row, ensure_ascii=False) + '\n')
            counts[peer]['decided'] += 1
            if counts[peer]['decided'] % 20 == 0:
                print(json.dumps({'peer': peer, 'done': counts[peer]['decided'], 'of': len(plan[peer]),
                                  'liabilityUsd': round(journal.liability(), 6)}), flush=True)

    pools = [ThreadPoolExecutor(max_workers=args.workers) for _ in chosen]
    futures = [pool.submit(work, peer, i) for pool, peer in zip(pools, chosen) for i in plan[peer]]
    for future in futures:
        future.result()
    for pool in pools:
        pool.shutdown()
    print(json.dumps({'finished': counts, 'liabilityUsd': journal.liability(), 'knownUsd': journal.known_usd,
                      'newCalls': journal.new_calls, 'stopped': stop.is_set()}), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
